import {latestKidsConnectionControl} from './kids-source-control-state';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {checkedKids,kidsNeedsUpgrade,kidsSourceSchema,type Kids} from './kids';
import {KidsError} from './kids-error';
import {kidsHash} from './kids-hash';
import {KIDS_HOSTED_CONSENT} from './kids-hosted-config';
import {noRemovalSql} from './kids-hosted-removal-state';
import {requireKidsService,kidsServiceGuard} from './kids-service';
import {billingNowSql as clock} from './stripe-provider';
import {kidsSourceIdentityTuple,type KidsSourceKeys} from './kids-source-key';
export {kidsSourceIdentityTuple} from './kids-source-key';

export type KidsSourceConnection={id:string;owner_user_id:string;workspace_id:string;slot_number:number;binding_id:string|null;label:string;status:'reserved'|'connected'|'removed';revision:number;source_epoch:number;discovery_consent:number;processing_consent:number;confirmed_at:string|null;paused:number;created_at:number;updated_at:number};
export type KidsChatSource={owner_user_id:string;workspace_id:string;app_chat_id:string;binding_id:string;provider_chat_id:string;identity_kind:'legacy'|'namespaced';created_at:number};
type Workspace={user_id:string;id:string;revision:number;epoch:number;document:string;operations:string};
type Binding={id:string;owner_user_id:string;workspace_id:string;revision:number;active:number;removed_at:number|null;application_id:string;production:number;endpoint_id:string;scope_id:string;account_id:string;provider_identity_hash:string;consent_version:string};
const id=z.string().min(1).max(180);
const prepareInput=z.object({action:z.literal('prepare'),operationId:z.string().uuid(),workspaceId:z.string().uuid(),baseRevision:z.number().int().min(1)}).strict();
const conflict=()=>new KidsError('This WhatsApp setup changed. Reopen its saved connections; earlier work is kept.',409);
export const kidsSourceDb=()=>{if(!env.DB)throw new KidsError('WhatsApp connection storage is unavailable.',503);return env.DB;};
async function workspace(db:D1Database,user:string,workspaceId:string){
 const row=await db.prepare('SELECT * FROM kids_state WHERE user_id=? AND id=?').bind(user,workspaceId).first<Workspace>();
 if(!row)throw new KidsError('Open your current Kids workspace.',404);
 const kids=checkedKids(JSON.parse(row.document));if(kidsNeedsUpgrade(kids,row.operations))throw new KidsError('Finish the saved Kids storage upgrade first. Earlier work is kept.',503);
 return {row,kids};
}
export const readKidsSourceConnection=(db:D1Database,user:string,workspaceId:string,bindingId:string)=>db.prepare('SELECT * FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? AND binding_id=?').bind(user,workspaceId,bindingId).first<KidsSourceConnection>();

// Pure cache projection. No credential/provider lookup or lazy migration.
export async function getKidsSourceConnections(user:string,workspaceId:string){
 z.string().uuid().parse(workspaceId);const db=kidsSourceDb(),{row,kids}=await workspace(db,user,workspaceId);
 const rows=(await db.prepare('SELECT * FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? ORDER BY slot_number,created_at,id').bind(user,workspaceId).all<KidsSourceConnection>()).results;
 const connections=await Promise.all(rows.map(async c=>{const latest=await latestKidsConnectionControl(db,user,row.id,c.id);return {id:c.id,bindingId:c.binding_id,label:c.label,slot:c.slot_number,status:c.status,revision:c.revision,sourceEpoch:c.source_epoch,discoveryConsent:!!c.discovery_consent,processingConsent:!!c.processing_consent,confirmedAt:c.confirmed_at,paused:!!c.paused,resumeFrom:c.paused&&latest?.receipt.result.action==='pause'?latest.operationId:null};}));
 // Recheck both the master revision and normalized rows in one read
 // transaction after receipt lookup. Preparation can add rows without changing
 // the master revision; controls must never mix either snapshot.
 const [current,currentRows]=await db.batch([db.prepare('SELECT revision FROM kids_state WHERE user_id=? AND id=?').bind(user,row.id),db.prepare('SELECT * FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? ORDER BY slot_number,created_at,id').bind(user,row.id)]);
 if((current.results[0] as {revision:number}|undefined)?.revision!==row.revision||JSON.stringify(currentRows.results)!==JSON.stringify(rows))throw new KidsError('WhatsApp settings changed while opening them. Reopen their current saved state.',409);
 return {workspaceId:row.id,boardRevision:row.revision,needsPreparation:!rows.length&&kids.mode==='live',connections,coverage:'Saved connection state only; no source account or messages were read.'};
}

// An explicit duplicate preflight, also used before the schema-only unique index.
// Return a count, never source bodies or a guessed duplicate winner.
export async function auditKidsSourceIdentities(db:D1Database,owner?:{user:string;workspace:string}){
 const sql='SELECT COUNT(*) n FROM (SELECT 1 FROM kids_source_records'+(owner?' WHERE owner_user_id=? AND workspace_id=?':'')+' GROUP BY owner_user_id,workspace_id,chat_id,message_id HAVING COUNT(*)>1)';
 return (await db.prepare(sql).bind(...(owner?[owner.user,owner.workspace]:[])).first<{n:number}>())!.n;
}

function legacyBinding(k:Kids,bindings:Binding[]){
 if(k.connection.accountId){
  const b=bindings.find(b=>k.connection.accountId==='hosted:'+b.id&&k.connection.selfUserId==='hosted-self:'+b.id);
  if(!b)throw conflict();return b;
 }
 if(k.connection.selfUserId||bindings.length!==1)throw conflict();return bindings[0];
}
function mappingSame(m:KidsChatSource,v:KidsChatSource){return m.owner_user_id===v.owner_user_id&&m.workspace_id===v.workspace_id&&m.app_chat_id===v.app_chat_id&&m.binding_id===v.binding_id&&m.provider_chat_id===v.provider_chat_id&&m.identity_kind===v.identity_kind;}
async function validMapping(m:KidsChatSource){return m.identity_kind==='legacy'?m.app_chat_id===m.provider_chat_id:m.identity_kind==='namespaced'&&m.app_chat_id===await kidsAppChatId(m.binding_id,m.provider_chat_id);}

// Shared by trusted collectors and migration, never by model-supplied mappings.
// Exact reuse does no write. Any key/tuple collision aborts the surrounding batch.
export function insertKidsChatSources(db:D1Database,values:KidsChatSource[],guard:{sql:string;values:(string|number|null)[]}){
 const field=(name:string)=>`json_extract(v.value,'$.${name}')`,identity=['owner_user_id','workspace_id','app_chat_id','binding_id','provider_chat_id','identity_kind'];
 return db.prepare(`INSERT INTO kids_chat_sources(owner_user_id,workspace_id,app_chat_id,binding_id,provider_chat_id,identity_kind,created_at) SELECT ${[...identity,'created_at'].map(field).join(',')} FROM json_each(?) v WHERE ${guard.sql} AND NOT EXISTS(SELECT 1 FROM kids_chat_sources m WHERE ${identity.map(name=>`m.${name}=${field(name)}`).join(' AND ')})`).bind(JSON.stringify(values),...guard.values);
}

// Adopt the already verified original binding. This never creates a provider
// connection, changes the saved board, rewrites source keys, or enables a grant.
export async function prepareKidsSourceConnections(user:string,input:unknown){
 const a=prepareInput.parse(input),db=kidsSourceDb(),hash=await kidsHash(JSON.stringify(['kids-source-prepare-v1',a]));
 const old=()=>db.prepare('SELECT body_hash,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,a.workspaceId,a.operationId).first<{body_hash:string;source_authority:string|null}>();
 const prior=await old();if(prior){if(prior.body_hash!==hash||!prior.source_authority||JSON.parse(prior.source_authority).kind!=='kids-source-prepare-v1')throw conflict();return {saved:true,retried:true,...await getKidsSourceConnections(user,a.workspaceId)};}
 const {row,kids}=await workspace(db,user,a.workspaceId);if(row.revision!==a.baseRevision||kids.mode!=='live')throw conflict();
 if(await auditKidsSourceIdentities(db,{user,workspace:row.id}))throw new KidsError('Earlier source identities need reconciliation. Nothing was changed.',409);
 if(await db.prepare('SELECT 1 ok FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_removals WHERE owner_user_id=? AND workspace_id=? AND operation_id=? LIMIT 1').bind(...Array.from({length:4},()=>[user,row.id,a.operationId]).flat()).first())throw conflict();
 const bindings=(await db.prepare('SELECT * FROM kids_hosted_bindings WHERE owner_user_id=? AND workspace_id=? AND removed_at IS NULL').bind(user,row.id).all<Binding>()).results,b=legacyBinding(kids,bindings);
 if(b.consent_version!==KIDS_HOSTED_CONSENT||!/^[a-f0-9]{64}$/.test(b.provider_identity_hash))throw conflict();
 const current=await readKidsSourceConnection(db,user,row.id,b.id);
 if(current&&(current.id!==b.id||current.status!=='connected'))throw conflict();
 const legacyCandidates=kids.candidates.filter(c=>c.accountId==='hosted:'+b.id),candidateIds=JSON.stringify(legacyCandidates.map(c=>c.id));
 const mappings=(await db.prepare('SELECT * FROM kids_chat_sources WHERE owner_user_id=? AND workspace_id=? AND (app_chat_id IN (SELECT value FROM json_each(?)) OR binding_id=? AND provider_chat_id IN (SELECT value FROM json_each(?)))').bind(user,row.id,candidateIds,b.id,candidateIds).all<KidsChatSource>()).results;
 const now=Date.now(),wanted:KidsChatSource[]=[];
 for(const candidate of legacyCandidates){
  const found=mappings.find(m=>m.app_chat_id===candidate.id);
  if(found){if(found.binding_id!==b.id||!await validMapping(found))throw conflict();continue;}
  // A new-style ID without its immutable map is damaged state, not a raw ID.
  if(/^wa:[a-f0-9-]{36}:[a-f0-9]{64}$/.test(candidate.id))throw conflict();
  const v:KidsChatSource={owner_user_id:user,workspace_id:row.id,app_chat_id:candidate.id,binding_id:b.id,provider_chat_id:candidate.id,identity_kind:'legacy',created_at:now};
  if(mappings.some(m=>m.binding_id===b.id&&m.provider_chat_id===v.provider_chat_id&&!mappingSame(m,v)))throw conflict();wanted.push(v);
 }
 // Preparation is a one-time structural adoption, not a new intent to save.
 // Repeated setup clicks cannot create receipts or reset local permissions.
 if(current){if(wanted.length)throw conflict();return {saved:false,alreadyPrepared:true,retried:false,...await getKidsSourceConnections(user,row.id)};}
 const service=kidsServiceGuard(await requireKidsService(user,row.id,false));
 const guard={sql:`EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND revision=? AND epoch=? AND ${service.sql} AND ${noRemovalSql}) AND EXISTS(SELECT 1 FROM kids_hosted_bindings WHERE id=? AND owner_user_id=? AND workspace_id=? AND revision=? AND active=? AND removed_at IS NULL AND application_id=? AND production=? AND endpoint_id=? AND scope_id=? AND account_id=? AND provider_identity_hash=? AND consent_version=?)`,values:[user,row.id,row.revision,row.epoch,...service.values,b.id,user,row.id,b.revision,b.active,b.application_id,b.production,b.endpoint_id,b.scope_id,b.account_id,b.provider_identity_hash,b.consent_version]};
 const receipt={kind:'kids-source-prepare-v1',bindingId:b.id,baseRevision:row.revision};
 const recorded={sql:`EXISTS(SELECT 1 FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=? AND body_hash=?) AND ${guard.sql}`,values:[user,row.id,a.operationId,hash,...guard.values]};
 const paused=Number(!kids.discoveryConsent||!b.active),processing=Number(kids.processingConsent&&!!kids.confirmedAt&&!paused);
 const result=await db.batch([
  db.prepare(`INSERT INTO kids_operation_receipts(owner_user_id,workspace_id,operation_id,body_hash,committed_revision,created_at,source_authority) SELECT ?,?,?,?,?,${clock},? WHERE ${guard.sql} AND NOT EXISTS(SELECT 1 FROM kids_source_connections WHERE id=?) ON CONFLICT(owner_user_id,workspace_id,operation_id) DO NOTHING RETURNING operation_id`).bind(user,row.id,a.operationId,hash,row.revision,JSON.stringify(receipt),...guard.values,b.id),
  db.prepare(`INSERT INTO kids_source_connections(id,owner_user_id,workspace_id,slot_number,binding_id,label,status,revision,source_epoch,discovery_consent,processing_consent,confirmed_at,paused,created_at,updated_at) SELECT ?,?,?,1,?,'WhatsApp 1','connected',1,0,?,?,?,?,?,? WHERE ${recorded.sql} AND NOT EXISTS(SELECT 1 FROM kids_source_connections WHERE id=? AND owner_user_id=? AND workspace_id=? AND binding_id=? AND status='connected')`).bind(b.id,user,row.id,b.id,Number(kids.discoveryConsent),processing,kids.confirmedAt,paused,now,now,...recorded.values,b.id,user,row.id,b.id),
  ...(wanted.length?[insertKidsChatSources(db,wanted,recorded)]:[]),
 ]);
 const saved=await old();if(!saved){if(!await readKidsSourceConnection(db,user,row.id,b.id))throw conflict();return prepareKidsSourceConnections(user,a);}if(saved.body_hash!==hash)throw conflict();
 return {saved:true,retried:!result[0].results.length,...await getKidsSourceConnections(user,row.id)};
}

export async function kidsAppChatId(bindingId:string,providerChatId:string){z.string().uuid().parse(bindingId);id.parse(providerChatId);return 'wa:'+bindingId+':'+await kidsHash(providerChatId);}
export async function readKidsChatSource(db:D1Database,user:string,workspaceId:string,appChatId:string){const m=await db.prepare('SELECT * FROM kids_chat_sources WHERE owner_user_id=? AND workspace_id=? AND app_chat_id=?').bind(user,workspaceId,appChatId).first<KidsChatSource>();if(m&&!await validMapping(m))throw conflict();return m;}

// The source path supplies its verified binding, never the interpretation.
// After preparation there is no fallback for a missing/different mapping.
export async function hostedBatchSourceKeys(db:D1Database,user:string,workspaceId:string,bindingId:string,appChatId:string,messageIds:string[]):Promise<KidsSourceKeys>{
 if(!messageIds.length)return new Map();
 const m=await readKidsChatSource(db,user,workspaceId,appChatId);
 if(m){if(m.binding_id!==bindingId)throw conflict();return hostedSourceKeys(db,user,workspaceId,appChatId,messageIds);}
 if(await db.prepare('SELECT 1 ok FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? LIMIT 1').bind(user,workspaceId).first())throw conflict();
 // Compatibility for the verified singleton path before explicit preparation.
 // Reuse its exact saved key; never choose another row by source-key spelling.
 id.parse(appChatId);z.array(id).min(1).max(10).parse(messageIds);if(new Set(messageIds).size!==messageIds.length)throw conflict();
 const rows=(await db.prepare('SELECT source_key,message_id,chat_id,source_json FROM kids_source_records WHERE owner_user_id=? AND workspace_id=? AND chat_id=? AND message_id IN ('+messageIds.map(()=>'?').join(',')+')').bind(user,workspaceId,appChatId,...messageIds).all<{source_key:string;message_id:string;chat_id:string;source_json:string}>()).results;
 const keys=new Map<string,string>();
 for(const messageId of messageIds){const matches=rows.filter(r=>r.message_id===messageId);if(matches.length>1)throw conflict();const saved=matches[0];if(saved){const s=kidsSourceSchema.parse(JSON.parse(saved.source_json));if(s.key!==saved.source_key||s.id!==messageId||s.chatId!==appChatId)throw conflict();}keys.set(kidsSourceIdentityTuple(appChatId,messageId),saved?.source_key??appChatId+':'+messageId);}
 const collisions=(await db.prepare('SELECT source_key,chat_id,message_id FROM kids_source_records WHERE owner_user_id=? AND workspace_id=? AND source_key IN ('+[...keys].map(()=>'?').join(',')+')').bind(user,workspaceId,...keys.values()).all<{source_key:string;chat_id:string;message_id:string}>()).results;
 for(const r of collisions)if(keys.get(kidsSourceIdentityTuple(r.chat_id,r.message_id))!==r.source_key)throw conflict();
 return keys;
}

// Keys are allocated by immutable mapping + the source-record tuple UNIQUE.
// This is a pure plan; the board transaction/CAS owns the eventual insertion.
export async function hostedSourceKeys(db:D1Database,user:string,workspaceId:string,appChatId:string,messageIds:string[]){
 id.parse(appChatId);z.array(id).min(1).max(10).parse(messageIds);if(new Set(messageIds).size!==messageIds.length)throw conflict();
 const m=await readKidsChatSource(db,user,workspaceId,appChatId);if(!m)throw conflict();
 const connection=await readKidsSourceConnection(db,user,workspaceId,m.binding_id);if(!connection||connection.id!==m.binding_id)throw conflict();
 const rows=(await db.prepare('SELECT source_key,message_id,chat_id,source_json FROM kids_source_records WHERE owner_user_id=? AND workspace_id=? AND chat_id=? AND message_id IN ('+messageIds.map(()=>'?').join(',')+')').bind(user,workspaceId,appChatId,...messageIds).all<{source_key:string;message_id:string;chat_id:string;source_json:string}>()).results;
 const keys=new Map<string,string>();
 for(const messageId of messageIds){
  const matches=rows.filter(r=>r.message_id===messageId);if(matches.length>1)throw conflict();const saved=matches[0];
  if(saved){const s=kidsSourceSchema.parse(JSON.parse(saved.source_json));if(s.key!==saved.source_key||s.id!==messageId||s.chatId!==m.app_chat_id)throw conflict();}
  const key=saved?.source_key??'hosted-source-v2:'+JSON.stringify([m.binding_id,m.provider_chat_id,messageId]);
  if(key.length>800)throw new KidsError('This source identity exceeds the saved-key limit. No message was saved.',413);
  keys.set(kidsSourceIdentityTuple(appChatId,messageId),key);
 }
 const collisions=(await db.prepare('SELECT source_key,chat_id,message_id FROM kids_source_records WHERE owner_user_id=? AND workspace_id=? AND source_key IN ('+[...keys].map(()=>'?').join(',')+')').bind(user,workspaceId,...keys.values()).all<{source_key:string;chat_id:string;message_id:string}>()).results;
 for(const r of collisions)if(keys.get(kidsSourceIdentityTuple(r.chat_id,r.message_id))!==r.source_key)throw conflict();
 return keys as ReadonlyMap<string,string>;
}
