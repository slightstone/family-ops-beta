import {coveredAuthStatus,connectionRemovalGuard,reusableRemovalScope} from './kids-hosted-removal-state';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {KidsError,checkedKids,kidsNeedsUpgrade} from './kids';
import {KIDS_HOSTED_CONSENT} from './kids-hosted-config';
import {kidsServiceGuard,requireKidsService,type ServiceStamp} from './kids-service';
import {billingNowSql as clock} from './stripe-provider';

const CONSENT=KIDS_HOSTED_CONSENT,LEASE=30000,LIFETIME=600000,RECOVERY_BUDGET=20000,WRITE_RESERVE=2000;
const text=z.string().min(1).max(512),scopeSchema=z.object({object:z.literal('Scope'),id:text,application_id:text,reference:z.string().nullable(),status:z.enum(['active','disabled'])});
const startSchema=z.object({operationId:z.string().uuid(),workspaceId:z.string().uuid(),baseRevision:z.number().int().min(1),consentVersion:z.literal(CONSENT),vendorSyncConfirmed:z.literal(true)}).strict();
const targetFields={connectionId:z.string().uuid(),connectionRevision:z.number().int().min(1),sourceEpoch:z.number().int().min(0)};
const addSchema=startSchema.extend({intent:z.literal('add'),connectionId:targetFields.connectionId.optional(),connectionRevision:targetFields.connectionRevision.optional(),sourceEpoch:targetFields.sourceEpoch.optional()}).strict().refine(v=>[v.connectionId,v.connectionRevision,v.sourceEpoch].every(x=>x===undefined)||[v.connectionId,v.connectionRevision,v.sourceEpoch].every(x=>x!==undefined));
const reconnectSchema=startSchema.extend({intent:z.literal('reconnect'),...targetFields}).strict();
type TargetRequest=z.infer<typeof reconnectSchema>|z.infer<typeof startSchema>&{intent:'add';connectionId?:string;connectionRevision?:number;sourceEpoch?:number};
const recoverSchema=startSchema.extend({recover:z.string().uuid()}).strict();
type RecoveryRequest=z.infer<typeof recoverSchema>;
type RecoveryResult='checking'|'empty'|'ambiguous'|'incomplete'|'unavailable'|'candidate'|'verified';
type Auth={intent:'add'|'reconnect'|null;slot_id:string|null;slot_revision:number|null;slot_epoch:number|null;recovery_of:string|null;recovery_result:RecoveryResult|null;owner_user_id:string;operation_id:string;workspace_id:string;body_hash:string;config_hash:string;application_id:string;production:number;endpoint_id:string;scope_reference:string;scope_id:string|null;workspace_revision:number;epoch:number;service_grant_id:string;service_revision:number;binding_id:string|null;binding_revision:number|null;expected_account_id:string|null;expected_identity_hash:string|null;state_hash:string|null;redirect_uri:string;consent_version:string;expires_at:number;created_at:number;status:string;lease_token:string|null;lease_until:number|null;auth_link:string|null;candidate_account_id:string|null;sync_status:string|null;completed_at:number|null;verified_binding_id:string|null;verified_identity_hash:string|null;now:number};
type Binding={id:string;revision:number;scope_id:string;account_id:string;provider_identity_hash:string};
type Workspace={id:string;revision:number;epoch:number;document:string;operations:string};
type Slot={id:string;binding_id:string|null;revision:number;source_epoch:number;status:string};
const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
const sha=async(s:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
const conflict=()=>new KidsError('This setup changed or expired. Return to Family Ops and check its connection status.',409);
import {kidsHostedSettings,readKidsHostedProvider,verifyKidsHostedAccount} from './kids-hosted-api';
export {kidsHostedSettings,readKidsHostedProvider,verifyKidsHostedAccount} from './kids-hosted-api';
type Settings=Awaited<ReturnType<typeof kidsHostedSettings>>;
const provider=readKidsHostedProvider,settings=kidsHostedSettings;
const read=(c:Settings,user:string,operation:string)=>c.DB.prepare(`SELECT *,${clock} AS now FROM kids_hosted_auth WHERE owner_user_id=? AND operation_id=?`).bind(user,operation).first<Auth>();
export function projectKidsHostedAuth(a:Pick<Auth,'now'|'recovery_of'|'status'|'lease_until'|'expires_at'|'recovery_result'|'candidate_account_id'|'endpoint_id'|'scope_id'|'operation_id'|'workspace_id'|'workspace_revision'|'intent'|'slot_id'|'slot_revision'|'slot_epoch'|'sync_status'>){
 const now=a.now??Date.now(),pairedCheck=!!a.recovery_of,retry=a.status==='verifying'&&(a.lease_until===null||a.lease_until<=now),expired=a.status!=='connected'&&a.expires_at<=now;
 const empty=pairedCheck&&a.status==='failed'&&a.recovery_result==='empty'&&!a.candidate_account_id;
 const canRecover=a.endpoint_id.startsWith('poll:')&&expired&&!!a.scope_id&&!['scope_unknown','scope_creating','failed'].includes(a.status);
 const recoveryRequest=pairedCheck?{operationId:a.operation_id,workspaceId:a.workspace_id,baseRevision:a.workspace_revision,consentVersion:CONSENT,vendorSyncConfirmed:true as const,recover:a.recovery_of}:undefined;
 return {workspaceId:a.workspace_id,setupId:a.operation_id,intent:a.intent,connectionId:a.slot_id,status:a.status,serverNow:now,syncStatus:a.sync_status??'unknown',expiresAt:a.expires_at,retryAt:a.lease_until,connected:a.status==='connected',pairedCheck,allowNewQr:empty,canRecover,recoveryResult:a.recovery_result,recoveryRequest,...(empty&&a.intent==='add'?{newQrTarget:{intent:'add',connectionId:a.slot_id,connectionRevision:a.slot_revision,sourceEpoch:a.slot_epoch}}:{}),
 recovery:expired?'check_expired_setup':retry?'retry_same_verification':null,coverage:'Saved verification only; live message coverage has not been established.',
 message:a.status==='connected'?'WhatsApp account verification saved. Choose its chats before tracking updates.':empty?'No paired WhatsApp account was found in this household connection. You can request a new QR.':canRecover?'The return to Family Ops timed out. If you scanned the QR, check the account already paired before requesting another.':pairedCheck&&a.recovery_result==='ambiguous'?'More than one account or conflicting account details were returned. Nothing was connected. Retry the same check; do not scan another QR.':pairedCheck&&a.recovery_result==='incomplete'?'The paired-account check was incomplete. Nothing was connected. Retry this same check.':pairedCheck&&a.recovery_result==='unavailable'?'The paired account could not be verified. Your board is kept. Retry this same check.':pairedCheck?'Checking the account already paired. No new QR or connection is being created.':expired?'This setup expired. Check its saved outcome before starting a new connection.':retry?'Verification did not complete. Continue this same setup to retry verification.':a.status.endsWith('unknown')?'The provider outcome is not confirmed. Your board is unchanged; check setup status before trying again.':a.status==='failed'?'Connection could not be verified. Your board is unchanged.':'Connection setup is in progress. No messages have been released for tracking.'};
}
const projection=projectKidsHostedAuth;
function fence(a:Auth,initial=false){
 const service=kidsServiceGuard({grantId:a.service_grant_id,revision:a.service_revision}),removal=connectionRemovalGuard(a.slot_id??a.binding_id);
 const local=a.intent?{sql:`(EXISTS(SELECT 1 FROM kids_source_connections slot WHERE slot.id=? AND slot.owner_user_id=kids_state.user_id AND slot.workspace_id=kids_state.id AND slot.revision=? AND slot.source_epoch=? AND slot.discovery_consent=1 AND slot.paused=0 AND ${a.intent==='add'?"slot.status='reserved' AND slot.binding_id IS NULL AND slot.processing_consent=0":"slot.status='connected' AND slot.binding_id=?"})${initial&&a.intent==='add'&&!a.scope_id?" OR (?=1 AND ?=0 AND NOT EXISTS(SELECT 1 FROM kids_source_connections slot WHERE slot.id=?))":''})`,values:[a.slot_id,a.slot_revision,a.slot_epoch,...(a.intent==='reconnect'?[a.binding_id]:[]),...(initial&&a.intent==='add'&&!a.scope_id?[a.slot_revision,a.slot_epoch,a.slot_id]:[])]}:{sql:'NOT EXISTS(SELECT 1 FROM kids_source_connections slot WHERE slot.owner_user_id=kids_state.user_id AND slot.workspace_id=kids_state.id)',values:[]};
 // The exact initial revision binds consent. Later navigation/manual edits may
 // advance revision, but only the same epoch and every source authority fence
 // can continue that immutable owned attempt.
 const legacyAlias=a.binding_id&&!a.intent?{sql:" AND (SELECT COUNT(*) FROM kids_hosted_bindings lb WHERE lb.owner_user_id=kids_state.user_id AND lb.workspace_id=kids_state.id AND lb.removed_at IS NULL)=1 AND ((json_extract(document,'$.connection.accountId')='' AND json_extract(document,'$.connection.selfUserId')='') OR (json_extract(document,'$.connection.accountId')=? AND json_extract(document,'$.connection.selfUserId')=?))",values:['hosted:'+a.binding_id,'hosted-self:'+a.binding_id]}:{sql:'',values:[]};
 const binding=a.binding_id?{sql:'EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.id=? AND b.owner_user_id=kids_state.user_id AND b.workspace_id=kids_state.id AND b.revision=? AND b.account_id=? AND b.scope_id=? AND b.provider_identity_hash=? AND b.application_id=? AND b.production=? AND b.endpoint_id=? AND b.consent_version=? AND b.removed_at IS NULL)'+legacyAlias.sql,values:[a.binding_id,a.binding_revision,a.expected_account_id,a.scope_id,a.expected_identity_hash,a.application_id,a.production,a.endpoint_id,a.consent_version,...legacyAlias.values]}:a.intent?{sql:'1',values:[]}:{sql:"json_extract(document,'$.connection.accountId')='' AND json_extract(document,'$.connection.selfUserId')='' AND NOT EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.owner_user_id=kids_state.user_id AND b.workspace_id=kids_state.id AND b.removed_at IS NULL)",values:[]};
 return {sql:`EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND revision${initial?'=':'>='}? AND epoch=? AND json_extract(document,'$.mode')='live' AND json_extract(document,'$.discoveryConsent')=1 AND ${service.sql} AND ${removal.sql} AND ${local.sql} AND ${binding.sql})`,values:[a.owner_user_id,a.workspace_id,a.workspace_revision,a.epoch,...service.values,...removal.values,...local.values,...binding.values]};
}
async function current(c:Settings,a:Auth){
 if(a.config_hash!==c.fingerprint||a.application_id!==c.UNIPILE_APPLICATION_ID||a.endpoint_id!==c.channelId||a.production!==Number(c.UNIPILE_ENVIRONMENT==='production'))throw conflict();
 const f=fence(a),ok=await c.DB.prepare(`SELECT 1 AS ok WHERE ${f.sql}`).bind(...f.values).first();if(!ok)throw conflict();
}
async function unknown(c:Settings,a:Auth,status:'scope_unknown'|'link_unknown'){
 await c.DB.prepare('UPDATE kids_hosted_auth SET status=?,lease_token=NULL,lease_until=NULL,auth_link=NULL WHERE owner_user_id=? AND operation_id=? AND lease_token=? AND status<>\'connected\'').bind(status,a.owner_user_id,a.operation_id,a.lease_token).run();
 const saved=await read(c,a.owner_user_id,a.operation_id);if(!saved)throw conflict();return projection(saved);
}
function checkedScope(c:Settings,a:Auth,value:unknown){const s=scopeSchema.parse(value);if(s.application_id!==a.application_id||s.application_id!==c.UNIPILE_APPLICATION_ID||s.reference!==a.scope_reference||s.status!=='active'||!s.id.startsWith('scope_'))throw new Error('SCOPE_UNCONFIRMED');return s.id;}
async function saveScope(c:Settings,a:Auth,scope:string){
 const result=await c.DB.prepare("UPDATE kids_hosted_auth SET scope_id=?,status='scope_ready',lease_token=NULL,lease_until=NULL WHERE owner_user_id=? AND operation_id=? AND lease_token=? AND status IN ('scope_creating','scope_unknown')").bind(scope,a.owner_user_id,a.operation_id,a.lease_token).run();if(!result.meta.changes)throw conflict();
}
async function prepareLink(c:Settings,a:Auth){
 await current(c,a);if(!a.scope_id)throw conflict();if(!a.intent&&!a.binding_id){const reusable=await reusableRemovalScope(c,a.owner_user_id,a.workspace_id);if(reusable&&reusable!==a.scope_id)throw conflict();}
 try{if(checkedScope(c,a,await provider(c,'/v2/scopes/'+encodeURIComponent(a.scope_id)))!==a.scope_id)throw new Error('SCOPE_UNCONFIRMED');}catch{throw new KidsError('The household connection scope could not be verified. Check setup status before retrying.',503);}
 const state=random(),token=crypto.randomUUID(),f=fence(a);
 const claim=await c.DB.prepare(`UPDATE kids_hosted_auth SET state_hash=?,status='link_creating',lease_token=?,lease_until=${clock}+${LEASE} WHERE owner_user_id=? AND operation_id=? AND status='scope_ready' AND expires_at>${clock} AND ${f.sql} RETURNING *`).bind(await sha(state),token,a.owner_user_id,a.operation_id,...f.values).first<Auth>();
 if(!claim)throw conflict();
 try{
  const data=z.object({object:z.literal('HostedAuthLink'),link:z.string().max(4000)}).parse(await provider(c,'/v2/auth/link',{...(claim.expected_account_id?{account_id:claim.expected_account_id}:{providers:'whatsapp'}),account_scope_id:claim.scope_id,expires_on:new Date(claim.expires_at).toISOString(),redirect_uri:claim.redirect_uri,state,config:{whatsapp:{allow_methods:['qr','pairing']},global:{wait_initial_sync:false}}}));
  if(!claim.intent&&!claim.binding_id){const reusable=await reusableRemovalScope(c,claim.owner_user_id,claim.workspace_id);if(reusable&&reusable!==claim.scope_id)throw conflict();}
  const link=new URL(data.link);if(link.protocol!=='https:'||link.hostname!=='auth.unipile.com'||link.port||link.username||link.password)throw new Error('LINK_UNCONFIRMED');
  const result=await c.DB.prepare(`UPDATE kids_hosted_auth SET status='ready',auth_link=?,lease_token=NULL,lease_until=NULL WHERE owner_user_id=? AND operation_id=? AND status='link_creating' AND lease_token=? AND lease_until>${clock} AND expires_at>${clock} AND ${f.sql} RETURNING *`).bind(data.link,a.owner_user_id,a.operation_id,token,...f.values).first<Auth>();
  if(!result)throw conflict();return {...projection(result),link:data.link};
 }catch{return unknown(c,claim,'link_unknown');}
}

const targetHash=(v:TargetRequest,a:Pick<Auth,'intent'|'slot_id'|'slot_revision'|'slot_epoch'>)=>sha(JSON.stringify(['kids-target-auth-v1',v,a.intent,a.slot_id,a.slot_revision,a.slot_epoch]));
async function reserveTarget(c:Settings,user:string,v:TargetRequest){
 const row=await c.DB.prepare('SELECT * FROM kids_state WHERE user_id=? AND id=?').bind(user,v.workspaceId).first<Workspace>();
 if(!row||row.revision!==v.baseRevision)throw conflict();const k=checkedKids(JSON.parse(row.document));if(kidsNeedsUpgrade(k,row.operations)||k.mode!=='live'||!k.discoveryConsent)throw conflict();
 const slot=v.connectionId?await c.DB.prepare('SELECT * FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? AND id=?').bind(user,row.id,v.connectionId).first<Slot>():null;
 if(v.connectionId&&(!slot||slot.revision!==v.connectionRevision||slot.source_epoch!==v.sourceEpoch))throw conflict();
 let b:Binding|null=null,scope:string|null=null,reference:string;
 const id=slot?.id??crypto.randomUUID(),revision=slot?.revision??1,epoch=slot?.source_epoch??0;
 if(v.intent==='reconnect'){
  if(!slot||slot.status!=='connected'||slot.binding_id!==slot.id)throw conflict();
  b=await c.DB.prepare('SELECT * FROM kids_hosted_bindings WHERE id=? AND owner_user_id=? AND workspace_id=? AND application_id=? AND production=? AND endpoint_id=? AND removed_at IS NULL AND consent_version=?').bind(slot.id,user,row.id,c.UNIPILE_APPLICATION_ID,Number(c.UNIPILE_ENVIRONMENT==='production'),c.channelId,CONSENT).first<Binding>();
  if(!b||!/^[a-f0-9]{64}$/.test(b.provider_identity_hash))throw conflict();scope=b.scope_id;
  const prior=await c.DB.prepare("SELECT scope_reference FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND verified_binding_id=? AND scope_id=? AND status='connected' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(user,row.id,b.id,scope).first<{scope_reference:string}>();
  if(!prior||!['familyops:'+row.id,'familyops:'+row.id+':slot:'+slot.id].includes(prior.scope_reference))throw conflict();
  if(prior.scope_reference==='familyops:'+row.id){const legacy=await c.DB.prepare("SELECT 1 ok WHERE NOT EXISTS(SELECT 1 FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND verified_binding_id=? AND intent IS NOT NULL AND status='connected' AND scope_reference<>?)").bind(user,row.id,b.id,prior.scope_reference).first();if(!legacy)throw conflict();}
  reference=prior.scope_reference;
 }else{
  reference='familyops:'+row.id+':slot:'+id;
  if(!slot&&await c.DB.prepare("SELECT 1 ok WHERE EXISTS(SELECT 1 FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? AND status='reserved') OR (SELECT COUNT(*) FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? AND status<>'removed')>=2 OR EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.owner_user_id=? AND b.workspace_id=? AND b.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM kids_source_connections s WHERE s.owner_user_id=b.owner_user_id AND s.workspace_id=b.workspace_id AND s.binding_id=b.id AND s.status='connected'))").bind(user,row.id,user,row.id,user,row.id).first())throw conflict();
  if(slot){
   const prior=await c.DB.prepare("SELECT * FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND slot_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(user,row.id,slot.id).first<Auth>();
   if(slot.status!=='reserved'||slot.binding_id!==null||!prior||prior.intent!=='add'||prior.status!=='failed'||prior.recovery_result!=='empty'||prior.candidate_account_id!==null||!prior.recovery_of||!prior.scope_id||prior.scope_reference!==reference||prior.slot_revision!==revision||prior.slot_epoch!==epoch)throw conflict();scope=prior.scope_id;
  }
 }
 const service=await requireKidsService(user,row.id,false),token=crypto.randomUUID();
 const a={intent:v.intent,slot_id:id,slot_revision:revision,slot_epoch:epoch,owner_user_id:user,operation_id:v.operationId,workspace_id:row.id,workspace_revision:row.revision,epoch:row.epoch,service_grant_id:service.grantId,service_revision:service.revision,binding_id:b?.id??null,binding_revision:b?.revision??null,expected_account_id:b?.account_id??null,expected_identity_hash:b?.provider_identity_hash??null,scope_id:scope,application_id:c.UNIPILE_APPLICATION_ID,production:Number(c.UNIPILE_ENVIRONMENT==='production'),endpoint_id:c.channelId,consent_version:CONSENT,scope_reference:reference} as Auth;
 const f=fence(a,true),hash=await targetHash(v,a);
 // The INSERT trigger reserves/adopts this exact slot in the same transaction.
 // A losing/racing auth INSERT cannot leave an orphan slot or reach a provider.
 const result=await c.DB.prepare(`INSERT INTO kids_hosted_auth(owner_user_id,operation_id,workspace_id,body_hash,config_hash,application_id,production,endpoint_id,scope_reference,scope_id,workspace_revision,epoch,service_grant_id,service_revision,binding_id,binding_revision,expected_account_id,expected_identity_hash,redirect_uri,consent_version,expires_at,created_at,status,lease_token,lease_until,intent,slot_id,slot_revision,slot_epoch)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${clock}+${LIFETIME},${clock},?,?,${clock}+${LEASE},?,?,?,? WHERE ${f.sql}
 AND NOT EXISTS(SELECT 1 FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND status NOT IN ('connected','expired','failed'))
 AND (SELECT COUNT(*) FROM kids_hosted_auth WHERE owner_user_id=? AND created_at>${clock}-3600000)<10 ON CONFLICT(owner_user_id,operation_id) DO NOTHING RETURNING *`).bind(user,v.operationId,row.id,hash,c.fingerprint,c.UNIPILE_APPLICATION_ID,Number(c.UNIPILE_ENVIRONMENT==='production'),c.channelId,reference,scope,row.revision,row.epoch,service.grantId,service.revision,b?.id??null,b?.revision??null,b?.account_id??null,b?.provider_identity_hash??null,c.origin+'/api/kids/source/unipile/callback',CONSENT,scope?'scope_ready':'scope_creating',token,v.intent,id,revision,epoch,...f.values,user,row.id,user).first<Auth>();
 const saved=await read(c,user,v.operationId);if(!saved||saved.body_hash!==await targetHash(v,saved))throw conflict();return {a:saved,created:!!result};
}

export async function startKidsHostedAuth(user:string,input:unknown){
 const c=await settings(),request=z.union([recoverSchema,addSchema,reconnectSchema,startSchema,z.object({resume:z.string().uuid()}).strict()]).parse(input);
 if('recover' in request)return startRecovery(c,user,request);
 if('resume' in request){const saved=await read(c,user,request.resume);if(saved?.recovery_of)return startRecovery(c,user,{operationId:saved.operation_id,workspaceId:saved.workspace_id,baseRevision:saved.workspace_revision,consentVersion:CONSENT,vendorSyncConfirmed:true,recover:saved.recovery_of});}
 let v:z.infer<typeof startSchema>|TargetRequest;
 if('resume' in request){const saved=await read(c,user,request.resume);if(!saved)throw conflict();v={operationId:saved.operation_id,workspaceId:saved.workspace_id,baseRevision:saved.workspace_revision,consentVersion:CONSENT,vendorSyncConfirmed:true};}else v=request;
 const resumed='resume' in request?await read(c,user,request.resume):null;
 const hash=resumed?resumed.body_hash:'intent' in v?null:await sha(JSON.stringify([v.workspaceId,v.baseRevision,v.consentVersion,v.vendorSyncConfirmed]));
 let a=await read(c,user,v.operationId),created=false;
 if(a){if(a.body_hash!==(hash??await targetHash(v as TargetRequest,a)))throw conflict();const removal=await coveredAuthStatus(c.DB,user,a.workspace_id,a.operation_id);if(removal)return {...projection(a),...removal};if(a.status==='connected')return projection(a);await current(c,a);}
 else if('intent' in v){({a,created}=await reserveTarget(c,user,v));}
 else{
  const row=await c.DB.prepare('SELECT * FROM kids_state WHERE user_id=? AND id=?').bind(user,v.workspaceId).first<Workspace>();if(!row||row.revision!==v.baseRevision)throw conflict();const k=checkedKids(JSON.parse(row.document));if(kidsNeedsUpgrade(k,row.operations)||k.mode!=='live'||!k.discoveryConsent)throw conflict();
  if(await c.DB.prepare('SELECT 1 ok FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? LIMIT 1').bind(user,row.id).first())throw conflict();
  const latest=await c.DB.prepare('SELECT * FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(user,row.id).first<Auth>();
  if(latest?.recovery_of&&latest.status!=='connected'&&!(latest.status==='failed'&&latest.recovery_result==='empty'&&!latest.candidate_account_id))throw conflict();
  const service:ServiceStamp=await requireKidsService(user,row.id,false),all=(await c.DB.prepare('SELECT * FROM kids_hosted_bindings WHERE owner_user_id=? AND workspace_id=? AND removed_at IS NULL').bind(user,row.id).all<Binding&{application_id:string}>()).results;
  if(all.length>1||all.length&&all[0].application_id!==c.UNIPILE_APPLICATION_ID)throw conflict();const b=all[0]??null;
  if(b&&(k.connection.accountId||k.connection.selfUserId)&&(k.connection.accountId!=='hosted:'+b.id||k.connection.selfUserId!=='hosted-self:'+b.id))throw conflict();
  if(b&&!/^[a-f0-9]{64}$/.test(b.provider_identity_hash))throw new KidsError('This earlier connection needs identity verification before reconnecting.',409);
  const previous=await c.DB.prepare('SELECT scope_id FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND application_id=? AND production=? AND scope_id IS NOT NULL ORDER BY created_at DESC LIMIT 1').bind(user,row.id,c.UNIPILE_APPLICATION_ID,Number(c.UNIPILE_ENVIRONMENT==='production')).first<{scope_id:string}>();
  const reusable=b?null:await reusableRemovalScope(c,user,row.id),scope=b?.scope_id??reusable??previous?.scope_id??null,token=crypto.randomUUID();
  const candidate={owner_user_id:user,operation_id:v.operationId,workspace_id:row.id,workspace_revision:row.revision,epoch:row.epoch,service_grant_id:service.grantId,service_revision:service.revision,binding_id:b?.id??null,binding_revision:b?.revision??null,expected_account_id:b?.account_id??null,expected_identity_hash:b?.provider_identity_hash??null,scope_id:scope,application_id:c.UNIPILE_APPLICATION_ID,production:Number(c.UNIPILE_ENVIRONMENT==='production'),endpoint_id:c.channelId,consent_version:CONSENT} as Auth,f=fence(candidate,true);
  // A stale or ambiguous scope effect is never abandoned to make another POST.
  const reserved=await c.DB.batch([
   c.DB.prepare(`UPDATE kids_hosted_auth SET status='expired',auth_link=NULL,lease_token=NULL,lease_until=NULL WHERE owner_user_id=? AND workspace_id=? AND status IN ('scope_ready','ready','link_unknown','link_creating','verifying') AND expires_at<=${clock} AND (lease_until IS NULL OR lease_until<=${clock})`).bind(user,row.id),
   c.DB.prepare(`INSERT INTO kids_hosted_auth(owner_user_id,operation_id,workspace_id,body_hash,config_hash,application_id,production,endpoint_id,scope_reference,scope_id,workspace_revision,epoch,service_grant_id,service_revision,binding_id,binding_revision,expected_account_id,expected_identity_hash,redirect_uri,consent_version,expires_at,created_at,status,lease_token,lease_until) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${clock}+${LIFETIME},${clock},?,?,${clock}+${LEASE} WHERE ${f.sql} AND NOT EXISTS(SELECT 1 FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND status NOT IN ('connected','expired','failed')) AND NOT EXISTS(SELECT 1 FROM (SELECT recovery_of,status,recovery_result,candidate_account_id FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1) WHERE recovery_of IS NOT NULL AND status<>'connected' AND NOT(status='failed' AND recovery_result='empty' AND candidate_account_id IS NULL)) AND (SELECT COUNT(*) FROM kids_hosted_auth WHERE owner_user_id=? AND created_at>${clock}-3600000)<10 ON CONFLICT(owner_user_id,operation_id) DO NOTHING`).bind(user,v.operationId,row.id,hash,c.fingerprint,c.UNIPILE_APPLICATION_ID,Number(c.UNIPILE_ENVIRONMENT==='production'),c.channelId,'familyops:'+row.id,scope,row.revision,row.epoch,service.grantId,service.revision,b?.id??null,b?.revision??null,b?.account_id??null,b?.provider_identity_hash??null,c.origin+'/api/kids/source/unipile/callback',CONSENT,scope?'scope_ready':'scope_creating',token,...f.values,user,row.id,user,row.id,user),
  ]);
  a=await read(c,user,v.operationId);if(!a)throw new KidsError('Another connection is pending or setup reached its hourly limit. Check connection status before starting again.',409);if(a.body_hash!==hash)throw conflict();created=!!reserved[1].meta.changes;
 }
 if(a.status==='expired'||a.status==='failed')return projection(a);
 if(a.expires_at<=a.now&&a.status!=='scope_unknown'&&a.status!=='scope_creating')throw conflict();
 if(a.status==='ready'){if(!a.auth_link)throw conflict();return {...projection(a),link:a.auth_link};}
 if(a.status==='link_creating'||a.status==='scope_creating'&&!created){
  await c.DB.prepare(`UPDATE kids_hosted_auth SET status=CASE status WHEN 'scope_creating' THEN 'scope_unknown' ELSE 'link_unknown' END,lease_token=NULL,lease_until=NULL WHERE owner_user_id=? AND operation_id=? AND status IN ('scope_creating','link_creating') AND lease_until<=${clock}`).bind(user,a.operation_id).run();
  a=(await read(c,user,a.operation_id))!;if(a.status!=='scope_unknown')return projection(a);
 }
 if(a.status==='verifying')return 'resume' in request&&a.candidate_account_id&&a.lease_until!==null&&a.lease_until<=a.now?verifyAttempt(c,a,a.candidate_account_id):projection(a);
 if(a.status==='link_unknown')return projection(a);
 if(a.status==='scope_creating'&&created){
  await current(c,a);try{await saveScope(c,a,checkedScope(c,a,await provider(c,'/v2/scopes/',{name:'Family Ops household',reference:a.scope_reference})));}catch{return unknown(c,a,'scope_unknown');}
  a=(await read(c,user,a.operation_id))!;
 }
 if(a.status==='scope_unknown'){
  await current(c,a);const f=fence(a),token=crypto.randomUUID(),claim=await c.DB.prepare(`UPDATE kids_hosted_auth SET lease_token=?,lease_until=${clock}+${LEASE} WHERE owner_user_id=? AND operation_id=? AND status='scope_unknown' AND (lease_until IS NULL OR lease_until<=${clock}) AND ${f.sql} RETURNING *`).bind(token,user,a.operation_id,...f.values).first<Auth>();if(!claim)return projection(a);
  try{let offset=0,complete=false;const found:string[]=[];for(let page=0;page<20;page++){
   const data=z.object({object:z.literal('Scopes'),data:z.array(scopeSchema).max(50),has_more:z.boolean()}).parse(await provider(c,'/v2/scopes/?'+new URLSearchParams({search:a.scope_reference,offset:String(offset),limit:'50'})));
   for(const s of data.data)if(s.reference===a.scope_reference)found.push(checkedScope(c,a,s));if(!data.has_more){complete=true;break;}if(!data.data.length)throw new Error('INCOMPLETE_SCOPE_READ');offset+=data.data.length;
  }if(!complete||found.length!==1)throw new Error('SCOPE_UNCONFIRMED');await saveScope(c,claim,found[0]);a=(await read(c,user,a.operation_id))!;}catch{return unknown(c,claim,'scope_unknown');}
 }
 if(a.status==='scope_ready')return prepareLink(c,a);return projection(a);
}

export async function finishKidsHostedAuth(user:string,url:URL){
 const c=await settings(),state=url.searchParams.get('state'),account=url.searchParams.get('account_id');if(!state||!/^[a-f0-9]{64}$/.test(state)||!account||!account.startsWith('acc_')||account.length>512||url.searchParams.get('provider')!=='whatsapp'||url.searchParams.has('error_title'))throw conflict();
 const a=await c.DB.prepare(`SELECT *,${clock} AS now FROM kids_hosted_auth WHERE owner_user_id=? AND state_hash=?`).bind(user,await sha(state)).first<Auth>();if(!a)throw conflict();return verifyAttempt(c,a,account);
}
async function verifyAttempt(c:Settings,a:Auth,account:string){
 const user=a.owner_user_id;if(a.candidate_account_id&&a.candidate_account_id!==account||a.expected_account_id&&a.expected_account_id!==account)throw conflict();
 const removal=await coveredAuthStatus(c.DB,user,a.workspace_id,a.operation_id);if(removal)return {...projection(a),...removal};if(a.status==='connected')return projection(a);await current(c,a);const f=fence(a),token=crypto.randomUUID();
 const claim=await c.DB.prepare(`UPDATE kids_hosted_auth SET status='verifying',candidate_account_id=?,lease_token=?,lease_until=${clock}+${LEASE} WHERE owner_user_id=? AND operation_id=? AND expires_at>${clock} AND (candidate_account_id IS NULL OR candidate_account_id=?) AND (status='ready' OR status='verifying' AND lease_until<=${clock}) AND ${f.sql} RETURNING *`).bind(account,token,user,a.operation_id,account,...f.values).first<Auth>();
 if(!claim){a=(await read(c,user,a.operation_id))!;if(a.candidate_account_id&&a.candidate_account_id!==account)throw conflict();if(a.status==='verifying'||a.status==='connected')return projection(a);throw conflict();}
 let identity:string,sync:string;
 try{
  ({identity,sync}=await verifyKidsHostedAccount(c,{accountId:account,applicationId:a.application_id,scopeId:a.scope_id!,identityHash:a.expected_identity_hash??undefined}));
 }catch{throw new KidsError('The WhatsApp account could not be verified. Continue this same setup after its verification wait; your board is unchanged.',503);}
 return completeAttempt(c,claim,token,account,identity,sync);
}
async function completeAttempt(c:Settings,a:Auth,token:string,account:string,identity:string,sync:string){
 // The AFTER UPDATE trigger creates/reconnects the binding and asserts its
 // exact outcome in this one D1 transaction. A binding failure rolls back the
 // consumed state and receipt, including clock-edge failures.
 const f=fence(a),user=a.owner_user_id;
 const saved=await c.DB.prepare(`UPDATE kids_hosted_auth SET status='connected',verified_binding_id=?,verified_identity_hash=?,sync_status=?,recovery_result=CASE WHEN recovery_of IS NOT NULL THEN 'verified' ELSE recovery_result END,completed_at=${clock},auth_link=NULL,lease_token=NULL,lease_until=NULL WHERE owner_user_id=? AND operation_id=? AND status='verifying' AND lease_token=? AND lease_until>${clock} AND expires_at>${clock} AND candidate_account_id=? AND ${f.sql} RETURNING *`).bind(a.slot_id??a.binding_id??crypto.randomUUID(),identity,sync,user,a.operation_id,token,account,...f.values).first<Auth>();
 if(!saved)throw conflict();return projection(saved);
}

// Recovery is a fresh, explicit owner operation. The original QR expiry and
// callback authorization stay immutable; only metadata GETs can occur here.
async function startRecovery(c:Settings,user:string,v:RecoveryRequest){
 if(c.transport!=='poll')throw conflict();
 let a=await read(c,user,v.operationId);
 const identity=a??await read(c,user,v.recover);if(!identity)throw conflict();
 const hash=await sha(JSON.stringify(['recover',v.recover,v.workspaceId,v.baseRevision,v.consentVersion,v.vendorSyncConfirmed,...(identity.intent?[identity.intent,identity.slot_id,identity.slot_revision,identity.slot_epoch]:[])]));
 if(a){
  if(a.body_hash!==hash||a.recovery_of!==v.recover)throw conflict();
  const removal=await coveredAuthStatus(c.DB,user,a.workspace_id,a.operation_id);if(removal)return {...projection(a),...removal};
  if(a.status==='connected'||a.status==='failed')return projection(a);await current(c,a);
 }else{
  const prior=await read(c,user,v.recover),row=await c.DB.prepare('SELECT * FROM kids_state WHERE user_id=? AND id=?').bind(user,v.workspaceId).first<Workspace>();
  if(!prior||!row||prior.workspace_id!==row.id||row.revision!==v.baseRevision||!prior.scope_id||prior.expires_at>prior.now||prior.lease_until!==null&&prior.lease_until>prior.now||['connected','failed','scope_unknown','scope_creating'].includes(prior.status))throw conflict();
  const k=checkedKids(JSON.parse(row.document));if(kidsNeedsUpgrade(k,row.operations)||k.mode!=='live'||!k.discoveryConsent)throw conflict();
  await current(c,prior);const service=await requireKidsService(user,row.id,false);
  const fresh={...prior,operation_id:v.operationId,workspace_revision:row.revision,epoch:row.epoch,service_grant_id:service.grantId,service_revision:service.revision} as Auth,f=fence(fresh,true);
  const latestSql='operation_id=(SELECT operation_id FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=?'+(prior.slot_id?' AND slot_id=?':'')+' ORDER BY created_at DESC,rowid DESC LIMIT 1)',latestValues=[user,row.id,...(prior.slot_id?[prior.slot_id]:[])];
  const results=await c.DB.batch([
   c.DB.prepare(`UPDATE kids_hosted_auth SET status='expired',auth_link=NULL,lease_token=NULL,lease_until=NULL WHERE owner_user_id=? AND operation_id=? AND expires_at<=${clock} AND (lease_until IS NULL OR lease_until<=${clock}) AND ${latestSql} AND ${f.sql}`).bind(user,prior.operation_id,...latestValues,...f.values),
   c.DB.prepare(`INSERT INTO kids_hosted_auth(owner_user_id,operation_id,workspace_id,body_hash,config_hash,application_id,production,endpoint_id,scope_reference,scope_id,workspace_revision,epoch,service_grant_id,service_revision,binding_id,binding_revision,expected_account_id,expected_identity_hash,redirect_uri,consent_version,expires_at,created_at,status,candidate_account_id,recovery_of,recovery_result,intent,slot_id,slot_revision,slot_epoch)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${clock}+${LIFETIME},${clock},'verifying',?,?,'checking',?,?,?,?
    WHERE ${f.sql} AND EXISTS(SELECT 1 FROM kids_hosted_auth WHERE owner_user_id=? AND operation_id=? AND status='expired' AND ${latestSql})
    AND NOT EXISTS(SELECT 1 FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND status NOT IN ('connected','expired','failed'))
    AND (SELECT COUNT(*) FROM kids_hosted_auth WHERE owner_user_id=? AND created_at>${clock}-3600000)<10 ON CONFLICT(owner_user_id,operation_id) DO NOTHING`)
    .bind(user,v.operationId,row.id,hash,c.fingerprint,prior.application_id,prior.production,prior.endpoint_id,prior.scope_reference,prior.scope_id,row.revision,row.epoch,service.grantId,service.revision,prior.binding_id,prior.binding_revision,prior.expected_account_id,prior.expected_identity_hash,prior.redirect_uri,CONSENT,prior.candidate_account_id,prior.operation_id,prior.intent,prior.slot_id,prior.slot_revision,prior.slot_epoch,...f.values,user,prior.operation_id,...latestValues,user,row.id,user),
  ]);
  a=await read(c,user,v.operationId);if(!a||a.body_hash!==hash||!results[1].meta.changes)throw conflict();
 }
 if(a.expires_at<=a.now)return projection(a);
 return recoverAttempt(c,a);
}
class RecoveryReadError extends Error{constructor(readonly result:'ambiguous'|'incomplete'){super('RECOVERY_UNCONFIRMED');}}
async function recoverAttempt(c:Settings,a:Auth){
 await current(c,a);const f=fence(a),token=crypto.randomUUID();
 const claim=await c.DB.prepare(`UPDATE kids_hosted_auth SET lease_token=?,lease_until=${clock}+${LEASE},recovery_result='checking' WHERE owner_user_id=? AND operation_id=? AND recovery_of IS NOT NULL AND status='verifying' AND expires_at>${clock} AND (lease_until IS NULL OR lease_until<=${clock}) AND ${f.sql} RETURNING *`).bind(token,a.owner_user_id,a.operation_id,...f.values).first<Auth>();
 if(!claim)return projection((await read(c,a.owner_user_id,a.operation_id))!);
 const deadline=performance.now()+RECOVERY_BUDGET;
 const remaining=()=>{const ms=deadline-performance.now()-WRITE_RESERVE;if(ms<=0)throw new RecoveryReadError('incomplete');return Math.min(8000,ms);};
 const get=async(path:string)=>{try{return await provider(c,path,undefined,remaining());}catch(e){if(deadline-performance.now()<=WRITE_RESERVE+25)throw new RecoveryReadError('incomplete');throw e;}};
 let account=claim.candidate_account_id;
 try{
  if(checkedScope(c,claim,await get('/v2/scopes/'+encodeURIComponent(claim.scope_id!)))!==claim.scope_id)throw new Error('SCOPE_UNCONFIRMED');
  if(!account){
   const seen=new Set<string>();let offset=0,complete=false;
   const listSchema=z.object({object:z.literal('Accounts'),data:z.array(z.object({object:z.literal('Account'),id:text,application_id:text,account_scope_id:text,provider:z.literal('whatsapp')})).max(5),has_more:z.boolean()});
   for(let page=0;page<4;page++){
    const data=listSchema.parse(await get('/v2/accounts/?'+new URLSearchParams({account_scope_id:claim.scope_id!,provider:'whatsapp',limit:'5',offset:String(offset)})));
    for(const found of data.data){if(seen.has(found.id)||!found.id.startsWith('acc_')||found.application_id!==claim.application_id||found.account_scope_id!==claim.scope_id)throw new RecoveryReadError('ambiguous');seen.add(found.id);}
    offset+=data.data.length;if(!data.has_more){complete=true;break;}if(!data.data.length||offset>=20)throw new RecoveryReadError('incomplete');
   }
   if(!complete)throw new RecoveryReadError('incomplete');remaining();
   if(seen.size>1)throw new RecoveryReadError('ambiguous');
   if(seen.size===0)return saveRecoveryOutcome(c,claim,token,'empty');
   account=[...seen][0];if(claim.expected_account_id&&account!==claim.expected_account_id)throw new RecoveryReadError('ambiguous');
   const selected=await c.DB.prepare(`UPDATE kids_hosted_auth SET candidate_account_id=?,recovery_result='candidate' WHERE owner_user_id=? AND operation_id=? AND status='verifying' AND lease_token=? AND lease_until>${clock} AND expires_at>${clock} AND candidate_account_id IS NULL AND ${f.sql} RETURNING *`).bind(account,claim.owner_user_id,claim.operation_id,token,...f.values).first<Auth>();
   if(!selected)throw conflict();
  }
  const {identity,sync}=await verifyKidsHostedAccount(c,{accountId:account,applicationId:claim.application_id,scopeId:claim.scope_id!,identityHash:claim.expected_identity_hash??undefined},remaining());
  remaining();return await completeAttempt(c,claim,token,account,identity,sync);
 }catch(e){
  // A final-write or authority failure must remain a failed transaction, never
  // turn an unverified result into a new-QR invitation.
  if(e instanceof KidsError)throw e;
  const result=e instanceof RecoveryReadError?e.result:deadline-performance.now()<=WRITE_RESERVE+25?'incomplete':'unavailable';
  return saveRecoveryOutcome(c,claim,token,result);
 }
}
async function saveRecoveryOutcome(c:Settings,a:Auth,token:string,result:'empty'|'ambiguous'|'incomplete'|'unavailable'){
 const f=fence(a),saved=await c.DB.prepare(`UPDATE kids_hosted_auth SET status=?,recovery_result=?,lease_token=NULL,lease_until=NULL WHERE owner_user_id=? AND operation_id=? AND status='verifying' AND lease_token=? AND lease_until>${clock} AND expires_at>${clock} AND ${result==='empty'?'candidate_account_id IS NULL AND ':''}${f.sql} RETURNING *`).bind(result==='empty'?'failed':'verifying',result,a.owner_user_id,a.operation_id,token,...f.values).first<Auth>();
 if(!saved)throw conflict();return projection(saved);
}

export async function kidsHostedAuthStatus(user:string,input?:{workspaceId:string;connectionId?:string;operationId?:string}){
 if(input)z.object({workspaceId:z.string().uuid(),connectionId:z.string().uuid().optional(),operationId:z.string().uuid().optional()}).strict().parse(input);
 const db=env.DB;if(!db)throw new KidsError('Saved WhatsApp setup status is unavailable.',503);
 const a=await db.prepare(`SELECT h.*,${clock} AS now FROM kids_hosted_auth h JOIN kids_state k ON k.user_id=h.owner_user_id AND k.id=h.workspace_id WHERE h.owner_user_id=?${input?' AND h.workspace_id=?':''}${input?.connectionId?' AND (h.slot_id=? OR h.binding_id=? OR h.verified_binding_id=?)':''}${input?.operationId?' AND h.operation_id=?':''} ORDER BY h.created_at DESC,h.rowid DESC LIMIT 1`).bind(user,...(input?[input.workspaceId]:[]),...(input?.connectionId?[input.connectionId,input.connectionId,input.connectionId]:[]),...(input?.operationId?[input.operationId]:[])).first<Auth>();
 return a?{...projection(a),...await coveredAuthStatus(db,user,a.workspace_id,a.operation_id)}:{status:'not_started',connected:false,syncStatus:'unknown',message:'No matching saved WhatsApp setup.'};
}
