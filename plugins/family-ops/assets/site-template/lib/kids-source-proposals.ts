import {env} from 'cloudflare:workers';
import {KidsError} from './kids';
import {kidsHash} from './kids-hash';
import {mutateKids,readKids} from './kids-store';
import {startKidsHostedAuth,kidsHostedAuthStatus} from './kids-hosted-auth';
import {removeKidsHostedSource,KIDS_REMOVE_CONSENT} from './kids-hosted-removal';
import {readRemoval,removalProjection} from './kids-hosted-removal-state';
import {KIDS_HOSTED_CONSENT} from './kids-hosted-config';
import {kidsServiceStatus} from './kids-service';
import {readKidsSourceSetup} from './kids-source-setup-state';
import {prepareKidsSourceConnections} from './kids-source-connections';
import {readRemovalApprovalAuthority,type RemovalApprovalAuthority} from './kids-hosted-removal-plan';
import {stageSourceSetupSchema,sourceProposalKey,approveSourceSetupSchema,type SourceSetupAction,type SourceProposalPreview} from './kids-source-contract';
import {billingNowSql as clock} from './stripe-provider';
import {collectKidsChatTitles,collectChatTitlesInput,titlePageHash} from './kids-chat-catalog';
import {readChatScan} from './kids-chat-catalog-state';

type Proposal={owner_user_id:string;workspace_id:string;proposal_id:string;stage_operation_id:string;stage_hash:string;effect_operation_id:string;effect_hash:string|null;proposal_hash:string;approval_digest:string;base_revision:number;payload_json:string;context_json:string;preview_json:string;created_at:number;expires_at:number;status:'staged'|'approved'|'cancelled';approved_at:number|null;cancelled_at:number|null;now:number};
type Payload={change:SourceSetupAction;command:Record<string,unknown>;kind:'board'|'auth'|'removal'|'prepare'|'titles'};
const db=()=>{if(!env.DB)throw new KidsError('WhatsApp approval storage is unavailable.',503);return env.DB;};
const conflict=()=>new KidsError('This WhatsApp proposal changed, expired or belongs to another setup. Reopen it and review a new proposal; earlier work is kept.',409);
const load=(user:string,workspace:string,id:string)=>db().prepare(`SELECT *,${clock} AS now FROM kids_source_proposals WHERE owner_user_id=? AND workspace_id=? AND proposal_id=?`).bind(user,workspace,id).first<Proposal>();
const approvalPhrase=(p:Pick<Proposal,'proposal_id'|'proposal_hash'>)=>'Approve WhatsApp '+p.proposal_id+' '+p.proposal_hash.slice(0,16);
const enabling=(a:SourceSetupAction)=>['enable-discovery','include-direct-titles','add','reconnect','check-paired','track','resume'].includes(a.action)||a.action==='source'&&a.enabled;
async function effectHash(p:Payload){const c=p.command;if(p.kind==='titles')return titlePageHash(collectChatTitlesInput.parse(c),'assistant');if(p.kind==='auth')return null;if(p.kind==='prepare')return kidsHash(JSON.stringify(['kids-source-prepare-v1',c]));if(p.kind==='removal')return kidsHash(JSON.stringify(['hosted-removal-v1',c]));if(c.type==='connectionControl')return kidsHash(JSON.stringify(['kids-connection-control-v1',c.workspaceId,c.baseRevision,c.args]));if(c.type==='confirm'||c.type==='source')return kidsHash(JSON.stringify(['kids-source-permission-v1','web',c.type,c.workspaceId,c.baseRevision,c.args]));return kidsHash(JSON.stringify({type:c.type,args:c.args,workspaceId:c.workspaceId}));}
async function context(user:string,workspace:string,action:SourceSetupAction){
 const needed=enabling(action),providerNeeded=needed||['remove-connection','remove-all'].includes(action.action);
 if(!providerNeeded)return {provider:null,service:null,authority:null};
 const c=env as unknown as Record<string,unknown>,provider=Object.fromEntries(['FAMILY_OPS_KIDS_LIVE','FAMILY_OPS_KIDS_HOSTED_SOURCE','FAMILY_OPS_KIDS_HOSTED_TRANSPORT','UNIPILE_APPLICATION_ID','UNIPILE_ENVIRONMENT','UNIPILE_WEBHOOK_ENDPOINT_ID','FAMILY_OPS_INSTALLATION_KIND','FAMILY_OPS_INSTALLATION_ID','FAMILY_OPS_INSTALLATION_OWNER_ID','FAMILY_OPS_PUBLIC_ORIGIN'].map(k=>[k,typeof c[k]==='string'?c[k]:null]));
 const service=needed?await db().prepare('SELECT grant_id,revision,kind,beta_until,billing_workspace_id,revoked_at,created_at FROM kids_service_access WHERE owner_user_id=? AND workspace_id=?').bind(user,workspace).first():null;
 const authority=['remove-connection','remove-all'].includes(action.action)?await readRemovalApprovalAuthority(db(),user,workspace,action.action==='remove-connection'?action.connection.id:undefined):null;
 return {provider,service,authority,...(action.action==='include-direct-titles'?{titleScan:await readChatScan(action.connection.id)}:{})};
}
// Canonical operation namespaces are checked for both generated IDs and the
// caller's staging-retry ID. A proposal is never a canonical effect receipt.
const collisionSql=(name:string)=>`EXISTS(SELECT 1 FROM kids_operation_receipts WHERE owner_user_id=?1 AND operation_id=${name}) OR EXISTS(SELECT 1 FROM kids_hosted_auth WHERE owner_user_id=?1 AND operation_id=${name}) OR EXISTS(SELECT 1 FROM kids_hosted_batches WHERE owner_user_id=?1 AND operation_id=${name}) OR EXISTS(SELECT 1 FROM kids_hosted_history_pages WHERE owner_user_id=?1 AND operation_id=${name}) OR EXISTS(SELECT 1 FROM kids_hosted_removals WHERE owner_user_id=?1 AND operation_id=${name}) OR EXISTS(SELECT 1 FROM kids_source_proposals WHERE owner_user_id=?1 AND (proposal_id=${name} OR effect_operation_id=${name} OR stage_operation_id=${name}))`;
async function anyCollision(user:string,ids:string[]){for(const id of ids){if(await db().prepare('SELECT 1 ok WHERE '+collisionSql('?2')).bind(user,id).first())return true;}return false;}

async function plan(user:string,workspace:string,revision:number,action:SourceSetupAction,effect:string){
 const saved=await readKids(user),k=saved.workspace,s=saved.sourceConnections;
 if(!k||k.id!==workspace||saved.revision!==revision||!s||s.boardRevision!==revision)throw conflict();
 if(s.wholeRemoval)throw new KidsError('Finish the saved household-wide connection removal first.',409);
 if(enabling(action)&&(!saved.liveEnabled||!saved.hostedSetupEnabled))throw new KidsError('Live WhatsApp setup or service is paused. Your board is kept.',403);
 const accounts:SourceProposalPreview['accounts']=[],base={operationId:effect,workspaceId:workspace,baseRevision:revision};let kind:Payload['kind']='board',command:Record<string,unknown>,title='',summary='',disclosure:string[]=[];
 const target='connection'in action?s.connections.find(c=>c.id===action.connection?.id):undefined;
 if('connection'in action&&action.connection&&(!target||target.revision!==action.connection.revision||target.sourceEpoch!==action.connection.sourceEpoch||target.status==='removed'||target.removalPending))throw conflict();
 if(target)accounts.push({id:target.id,label:target.label});
 if(action.action==='prepare'){
  if(!s.needsPreparation)throw conflict();title='Prepare the saved WhatsApp connection';summary='Keep the current verified account and its exact saved chat identities.';disclosure=['This adopts the existing single verified connection into labelled account settings. It does not pair another WhatsApp, change tracking permissions or read messages.'];kind='prepare';command={action:'prepare',...base};
 }else if(action.action==='enable-discovery'){
  if(k.mode==='live'&&k.discoveryConsent)throw new KidsError('Chat-title discovery is already enabled. You can connect WhatsApp.',409);
  if(k.mode==='practice'&&(k.candidates.length||k.sources.length||k.grants.length||k.contexts.length))throw new KidsError('Keep or export your practice board before starting a live setup. No examples will be removed by this approval.',409);
  title='Enable WhatsApp chat-title discovery';summary='Prepare this board for live WhatsApp setup. Message tracking stays unchanged.';
  disclosure=['Changes this board to live mode, permits chat-title discovery and advances its master source epoch. No WhatsApp account is paired and no provider is called by this step.','Existing saved board work and tracking grants are preserved. Connecting an account and reading selected messages need separate approvals.'];
  command={...base,type:'liveDiscovery',args:{consent:true}};
 }else if(action.action==='include-direct-titles'){
  const scan=target?.bindingId?await readChatScan(target.bindingId):null;
  if(!target||target.status!=='connected'||target.paused||!target.discoveryConsent||!target.bindingId||(scan?.revision??0)!==action.scanRevision)throw conflict();
  title='Include group and one-to-one chat titles';summary='Only '+target.label+' will be searched. Message tracking stays unchanged.';
  disclosure=['Reads: One page of up to 20 chat metadata records, then further pages in this same approved scan. Only group and one-to-one titles, IDs, type and activity time are saved in your private installation.','Never does: Fetch message history, contacts or attachments, save or expose provider previews or participants, or grant message processing. Channel titles are excluded.','Known gaps: More titles may remain. Your assistant can suggest relevant chats from these titles; you review the exact chats and people before any messages are read. A new assistant scan needs a new approval.'];
  kind='titles';command={...base,bindingId:target.bindingId,scanRevision:action.scanRevision,action:'restart',scope:'all',allTitlesConfirmed:true};
 }else if(action.action==='add'||action.action==='reconnect'){
  if(k.mode!=='live'||!k.discoveryConsent)throw new KidsError('First review and approve enable-discovery. Message processing is a separate choice.',409);
  if(action.action==='add'&&(!target&&s.connections.filter(c=>c.status!=='removed').length>=2||target&&target.status!=='reserved'))throw conflict();
  if(action.action==='reconnect'&&(!target||target.status!=='connected'||target.paused))throw conflict();
  title=action.action==='add'?'Connect another WhatsApp':'Reconnect '+target!.label;summary=target?'Only '+target.label+' is the connection target.':'Add a new WhatsApp to this same board. Existing accounts stay saved.';
  disclosure=['Unipile hosts the connection and may sync/store the wider WhatsApp account and history until that linked account is removed. Selected chats limit Family Ops processing, not that wider provider sync.','This starts a provider authorization link. Scan its QR or sign in yourself. Family Ops can load chat titles after pairing; message bodies need a separate tracking approval. No sends, replies or read-state changes.'];
  kind='auth';command={...base,intent:action.action,consentVersion:KIDS_HOSTED_CONSENT,vendorSyncConfirmed:true,...(target?{connectionId:target.id,connectionRevision:target.revision,sourceEpoch:target.sourceEpoch}:{})};
 }else if(action.action==='check-paired'){
  const a=await kidsHostedAuthStatus(user,{workspaceId:workspace,operationId:action.setupId});
  if(!('setupId'in a)||!a.canRecover)throw conflict();
  const c=s.connections.find(c=>c.id===a.connectionId);if(c)accounts.push({id:c.id,label:c.label});
  title='Check the WhatsApp already paired';summary='Recover the exact saved setup. This does not request a new QR.';
  disclosure=['Rechecks the already-approved provider scope for this saved setup. A new account is not created. Conflicting or incomplete results stay unresolved; message tracking needs separate approval.'];kind='auth';command={...base,consentVersion:KIDS_HOSTED_CONSENT,vendorSyncConfirmed:true,recover:action.setupId};
 }else if(action.action==='track'){
  if(new Set(action.targets.map(t=>t.bindingId)).size!==action.targets.length)throw conflict();
  for(const t of action.targets){
   const c=s.connections.find(c=>c.bindingId===t.bindingId);if(!c||c.status!=='connected'||c.paused||c.removalPending||!c.discoveryConsent||c.revision!==t.revision||c.sourceEpoch!==t.sourceEpoch)throw conflict();
   const pending=k.candidates.filter(v=>v.accountId==='hosted:'+t.bindingId&&v.decision==='selected'&&(!k.confirmedAt||v.reviewPending));
   if(!pending.length||JSON.stringify(pending.map(c=>c.id).sort())!==JSON.stringify([...t.chatIds].sort())||new Set(t.chatIds).size!==t.chatIds.length)throw conflict();
   const person=(id:string)=>k.children.find(child=>child.id===id)?.name??'Everyone / family';
   accounts.push({id:c.id,label:c.label,chats:pending.map(v=>{const old=k.grants.find(g=>g.chatId===v.id);if(old&&(old.topic!==v.topic||(old.attendanceAuthority??'reported')!==(v.attendanceAuthority??'reported')))throw new KidsError('This saved chat’s scope changed as well as its person. Restore its saved scope before reviewing the person change.',409);return {id:v.id,title:v.title,person:old?(old.childId===v.childId?person(v.childId):person(old.childId)+' → '+person(v.childId))+(!old.enabled?' · resumes tracking':''):person(v.childId)};})});
  }
  title='Track these exact WhatsApp chats';summary='Only the chats and people shown below are approved. Other pending choices stay pending.';
  disclosure=['Reads: Selected messages from the past seven days and future updates.','Sends and saves: Original text goes to your connected AI for translation and interpretation. Originals, translations and useful board facts are saved in your private installation.','May add: Homework, updates, school closures, chugim or temporary preparation from the same chat. AI selects the workflow.','Never does: Replies, payments or read-state changes.','Known gaps: Incomplete history and unavailable media stay visible.'];command={...base,type:'confirm',args:{consent:true,targets:action.targets}};
 }else if(action.action==='pause'||action.action==='resume'){
  if(!target||target.status!=='connected'||target.paused!==(action.action==='resume')||action.action==='resume'&&(target.resumeFrom??undefined)!==action.resumeFrom)throw conflict();
  title=(action.action==='pause'?'Pause ':'Resume ')+target.label;summary=action.action==='pause'?'Stop this account’s title discovery and processing. Keep its saved board and chat settings.':'Restore this account only. Changed source authority requires a fresh chat review.';
  disclosure=[action.action==='pause'?'The provider remains linked and may continue syncing. This pauses Family Ops discovery/processing only. Saved board work and the other WhatsApp stay available.':'Only authority recorded in the latest saved pause may resume. If it changed, only title discovery resumes and messages stay blocked until you confirm the chats again.'];command={...base,type:'connectionControl',args:{action:action.action,connection:action.connection,confirmed:true,...(action.action==='resume'&&action.resumeFrom?{resumeFrom:action.resumeFrom}:{})}};
 }else if(action.action==='source'){
  const candidate=k.candidates.find(c=>c.id===action.chatId&&c.accountId==='hosted:'+target?.id),grant=k.grants.find(g=>g.chatId===candidate?.id);if(!target||!candidate||!grant)throw conflict();
  accounts[0].chats=[{id:candidate.id,title:candidate.title,person:k.children.find(c=>c.id===grant.childId)?.name??'Everyone / family'}];title=(action.enabled?'Resume ':'Pause ')+'this chat';summary='Keep its saved people and workflow settings.';disclosure=['This changes only the displayed chat’s tracking permission. Reassigning a child requires a fresh chat review. Existing board facts stay saved.'];command={...base,type:'source',args:{chatId:action.chatId,enabled:action.enabled,connection:{bindingId:target.id,revision:target.revision,sourceEpoch:target.sourceEpoch}}};
 }else{
  if(action.action==='remove-all'){const current=s.connections.filter(c=>c.status!=='removed');if(!current.length)throw conflict();accounts.push(...current.map(c=>({id:c.id,label:c.label})));}
  else if(!target)throw conflict();
  title=action.action==='remove-all'?'Remove all hosted WhatsApp connections':'Remove '+target!.label;summary='Pause the displayed connection scope, then verify it is removed at the provider. Keep saved board work and export.';
  disclosure=['This unlinks the displayed hosted WhatsApp connection scope. It does not delete your native WhatsApp groups/messages or saved board. Unexpired setup links may need to expire first. Unknown provider results remain paused and must be checked through this same operation.','This does not change a subscription or cancel any separate provider charges.'];kind='removal';command={...base,consentVersion:KIDS_REMOVE_CONSENT,confirmed:true,...(action.action==='remove-connection'?{connection:action.connection}:{})};
 }
 return {payload:{change:action,command,kind} satisfies Payload,preview:{title,summary,accounts,disclosure} satisfies SourceProposalPreview,context:await context(user,workspace,action)};
}

function publicProposal(p:Proposal){return {id:p.proposal_id,hash:p.proposal_hash,workspaceId:p.workspace_id,baseRevision:p.base_revision,effectOperationId:p.effect_operation_id,status:p.status,createdAt:p.created_at,expiresAt:p.expires_at,serverNow:p.now,approvedAt:p.approved_at,cancelledAt:p.cancelled_at,preview:JSON.parse(p.preview_json) as SourceProposalPreview,...(p.status==='staged'?{approval:approvalPhrase(p)}:{}),coverage:'Proposal only. Approval status does not establish that its separate effect completed.'};}
export async function stageKidsSourceSetup(user:string,input:unknown){
 const a=stageSourceSetupSchema.parse(input),hash=await kidsHash(JSON.stringify(['kids-source-stage-v1',a])),existing=await db().prepare(`SELECT *,${clock} AS now FROM kids_source_proposals WHERE owner_user_id=? AND stage_operation_id=?`).bind(user,a.operation_id).first<Proposal>();
 if(existing){if(existing.stage_hash!==hash||existing.workspace_id!==a.workspace_id)throw conflict();return {...publicProposal(existing),retried:true};}
 const id=crypto.randomUUID(),effect=crypto.randomUUID();if(await anyCollision(user,[a.operation_id,id,effect]))throw conflict();
 const planned=await plan(user,a.workspace_id,a.expected_revision,a.change,effect),payload=JSON.stringify(planned.payload),contextJson=JSON.stringify(planned.context),preview=JSON.stringify(planned.preview),expectedHash=await effectHash(planned.payload),proposalHash=await kidsHash(JSON.stringify(['kids-source-proposal-v1',user,a.workspace_id,id,effect,a.expected_revision,payload,contextJson,preview,expectedHash])),digest=await kidsHash(approvalPhrase({proposal_id:id,proposal_hash:proposalHash}));
 const noCollision=[a.operation_id,id,effect].map((_,i)=>'NOT ('+collisionSql('?'+(i+2))+')').join(' AND ');
 const created=await db().prepare(`INSERT INTO kids_source_proposals(owner_user_id,stage_operation_id,proposal_id,effect_operation_id,workspace_id,stage_hash,proposal_hash,approval_digest,base_revision,payload_json,context_json,preview_json,effect_hash,created_at,expires_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,${clock},${clock}+900000 WHERE ${noCollision} AND EXISTS(SELECT 1 FROM kids_state WHERE user_id=?1 AND id=?5 AND revision=?9) AND (SELECT COUNT(*) FROM kids_source_proposals WHERE owner_user_id=?1 AND workspace_id=?5 AND status='staged' AND expires_at>${clock})<20 ON CONFLICT(owner_user_id,stage_operation_id) DO NOTHING RETURNING proposal_id`).bind(user,a.operation_id,id,effect,a.workspace_id,hash,proposalHash,digest,a.expected_revision,payload,contextJson,preview,expectedHash).first();
 if(!created){const old=await db().prepare(`SELECT *,${clock} AS now FROM kids_source_proposals WHERE owner_user_id=? AND stage_operation_id=?`).bind(user,a.operation_id).first<Proposal>();if(old&&old.stage_hash===hash)return {...publicProposal(old),retried:true};throw conflict();}
 return publicProposal((await load(user,a.workspace_id,id))!);
}
async function owned(user:string,input:unknown){const key=sourceProposalKey.parse(input),p=await load(user,key.workspace_id,key.proposal_id);if(!p||p.proposal_hash!==key.proposal_hash)throw conflict();return p;}
async function effectStatus(p:Proposal){
 const payload=JSON.parse(p.payload_json) as Payload;
 if(payload.kind==='titles'){
  const r=await db().prepare('SELECT body_hash,committed_revision,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(p.owner_user_id,p.workspace_id,p.effect_operation_id).first<{body_hash:string;committed_revision:number;source_authority:string|null}>();
  const a=r?.source_authority?JSON.parse(r.source_authority):null;
  if(r&&(r.body_hash!==p.effect_hash||a?.kind!=='kids-title-page-v1'||a.bindingId!==payload.command.bindingId||a.scopeApproval?.proposalId!==p.proposal_id||a.scopeApproval?.proposalHash!==p.proposal_hash||a.scopeApproval?.effectHash!==p.effect_hash))throw conflict();
  return {exists:!!r,kind:'titles',saved:r?{committedRevision:r.committed_revision,scan:a.scan,loaded:a.loaded,excludedChannels:a.excludedChannels??0}:null};
 }
 if(payload.kind==='auth'){
  const row=await db().prepare('SELECT body_hash,intent,slot_id,slot_revision,slot_epoch,recovery_of,workspace_revision FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(p.owner_user_id,p.workspace_id,p.effect_operation_id).first<{body_hash:string;intent:string|null;slot_id:string|null;slot_revision:number|null;slot_epoch:number|null;recovery_of:string|null;workspace_revision:number}>();
  if(row){const c=payload.command,v={operationId:c.operationId,workspaceId:c.workspaceId,baseRevision:c.baseRevision,consentVersion:c.consentVersion,vendorSyncConfirmed:c.vendorSyncConfirmed,...(c.intent?{intent:c.intent}:{}),...(c.connectionId?{connectionId:c.connectionId,connectionRevision:c.connectionRevision,sourceEpoch:c.sourceEpoch}:{}),...(c.recover?{recover:c.recover}:{})},expected=c.recover?await kidsHash(JSON.stringify(['recover',c.recover,c.workspaceId,c.baseRevision,c.consentVersion,c.vendorSyncConfirmed,...(row.intent?[row.intent,row.slot_id,row.slot_revision,row.slot_epoch]:[])])):await kidsHash(JSON.stringify(['kids-target-auth-v1',v,row.intent,row.slot_id,row.slot_revision,row.slot_epoch]));if(row.body_hash!==expected||row.workspace_revision!==p.base_revision||c.intent&&row.intent!==c.intent||c.recover&&row.recovery_of!==c.recover||c.connectionId&&row.slot_id!==c.connectionId)throw conflict();}
  const a=await kidsHostedAuthStatus(p.owner_user_id,{workspaceId:p.workspace_id,operationId:p.effect_operation_id});return {exists:!!row,kind:'auth',saved:a};
 }
 if(payload.kind==='removal'){const r=await readRemoval(db(),p.owner_user_id,p.workspace_id,p.effect_operation_id);if(r&&(r.body_hash!==p.effect_hash||r.target_connection_id!==(payload.change.action==='remove-connection'?payload.change.connection.id:null)))throw conflict();return {exists:!!r,kind:'removal',saved:r?await removalProjection(db(),r):null};}
 const r=await db().prepare('SELECT committed_revision,body_hash,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(p.owner_user_id,p.workspace_id,p.effect_operation_id).first<{committed_revision:number;body_hash:string;source_authority:string|null}>();if(r){const expectedKind=payload.kind==='prepare'?'kids-source-prepare-v1':payload.command.type==='connectionControl'?'kids-connection-control-v1':['confirm','source'].includes(String(payload.command.type))?'kids-source-permission-v1':null;if(r.body_hash!==p.effect_hash||(r.source_authority?JSON.parse(r.source_authority).kind:null)!==expectedKind)throw conflict();}return {exists:!!r,kind:payload.kind,saved:r?{committedRevision:r.committed_revision}:null};
}
export async function getKidsSourceProposal(user:string,input:unknown){
 const p=await owned(user,input),effect=await effectStatus(p);let canContinue=p.status==='approved',state=effect.exists?'saved':p.status==='approved'?'approved_not_started':p.status;
 if(p.status==='approved'&&!effect.exists){const payload=JSON.parse(p.payload_json) as Payload,row=await db().prepare('SELECT revision FROM kids_state WHERE user_id=? AND id=?').bind(user,p.workspace_id).first<{revision:number}>();canContinue=row?.revision===p.base_revision&&JSON.stringify(await context(user,p.workspace_id,payload.change))===p.context_json&&(!enabling(payload.change)||(await kidsServiceStatus(user,p.workspace_id)).active);if(!canContinue)state='rejected_before_effect';}
 return {...publicProposal(p),effect:{...effect,state,canContinue},next:state==='rejected_before_effect'?'No canonical effect was started. Review a new proposal against the current saved setup.':null};
}
export async function cancelKidsSourceProposal(user:string,input:unknown){
 let p=await owned(user,input);if(p.status==='approved')throw new KidsError('This proposal was already approved. Check its saved effect; cancellation cannot undo it.',409);
 if(p.status==='staged')await db().prepare(`UPDATE kids_source_proposals SET status='cancelled',cancelled_at=${clock} WHERE owner_user_id=? AND workspace_id=? AND proposal_id=? AND proposal_hash=? AND status='staged'`).bind(user,p.workspace_id,p.proposal_id,p.proposal_hash).run();
 p=(await load(user,p.workspace_id,p.proposal_id))!;if(p.status!=='cancelled')throw conflict();return publicProposal(p);
}
async function execute(p:Proposal,recover=false){
 const payload=JSON.parse(p.payload_json) as Payload,status=await effectStatus(p);
 if(status.exists&&(status.kind==='titles'||status.kind==='auth'&&(status.saved as {connected?:boolean})?.connected||status.kind==='removal'&&(status.saved as {status?:string})?.status==='completed'))return {...publicProposal(p),result:status.saved,effect:status};
 if(!status.exists){
  const saved=await readKids(p.owner_user_id);if(saved.workspace?.id!==p.workspace_id||saved.revision!==p.base_revision||JSON.stringify(await context(p.owner_user_id,p.workspace_id,payload.change))!==p.context_json)throw new KidsError('The approved proposal has no saved effect and its setup changed. Review a new proposal; no new effect was started.',409);
  if(enabling(payload.change)&&!(await kidsServiceStatus(p.owner_user_id,p.workspace_id)).active)throw new KidsError('Service is paused. No new effect was started; review again when it resumes.',403);
 }
 let result:unknown;
 if(payload.kind==='titles')result=await collectKidsChatTitles(p.owner_user_id,payload.command,'assistant',{proposalId:p.proposal_id,proposalHash:p.proposal_hash});
 else if(payload.kind==='prepare')result=await prepareKidsSourceConnections(p.owner_user_id,payload.command);
 else if(payload.kind==='board')result=await mutateKids(p.owner_user_id,payload.command);
 else if(payload.kind==='auth')result=await startKidsHostedAuth(p.owner_user_id,recover&&status.exists?{resume:p.effect_operation_id}:payload.command);
 else result=await removeKidsHostedSource(p.owner_user_id,recover&&status.exists?{operationId:p.effect_operation_id,workspaceId:p.workspace_id,resume:true}:payload.command,(JSON.parse(p.context_json) as {authority:RemovalApprovalAuthority}).authority);
 return {...publicProposal(p),result,effect:await effectStatus(p)};
}
export async function approveKidsSourceSetup(user:string,input:unknown){
 const a=approveSourceSetupSchema.parse(input);let p=await owned(user,{workspace_id:a.workspace_id,proposal_id:a.proposal_id,proposal_hash:a.proposal_hash});
 if(await kidsHash(a.approval)!==p.approval_digest||a.approval!==approvalPhrase(p))throw new KidsError('Use only the exact approval submitted by the parent for this displayed proposal.',403);
 if(p.status==='cancelled')throw conflict();
 if(p.status==='staged'){
  const payload=JSON.parse(p.payload_json) as Payload,review=await plan(user,p.workspace_id,p.base_revision,payload.change,p.effect_operation_id);
  if(JSON.stringify(review.payload)!==p.payload_json||JSON.stringify(review.preview)!==p.preview_json||JSON.stringify(review.context)!==p.context_json)throw conflict();
  await db().prepare(`UPDATE kids_source_proposals SET status='approved',approved_at=${clock} WHERE owner_user_id=? AND workspace_id=? AND proposal_id=? AND proposal_hash=? AND approval_digest=? AND status='staged' AND expires_at>${clock} AND EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND revision=?)`).bind(user,p.workspace_id,p.proposal_id,p.proposal_hash,p.approval_digest,user,p.workspace_id,p.base_revision).run();
  p=(await load(user,p.workspace_id,p.proposal_id))!;if(p.status!=='approved')throw conflict();
 }
 return execute(p);
}
export async function continueKidsSourceSetup(user:string,input:unknown){const p=await owned(user,input);if(p.status!=='approved')throw new KidsError('This proposal has not been approved by the parent.',403);return execute(p,true);}
export const getKidsSourceSetup=readKidsSourceSetup;
