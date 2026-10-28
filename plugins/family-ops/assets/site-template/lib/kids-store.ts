import {resolveKidsAccess,requireKidsOwner,assertKidsMemberBinding,assertManualMemberCommand,kidsMemberFence,kidsManualAudit,recheckKidsAccess,type KidsAccess} from './kids-access';
import {kidsMemberView} from './kids-member-view';
import {changeParentItem,type ParentItemReceipt} from './kids-parent-items';
import {prepareKidsConnectionControl,kidsConnectionControlStatements,type ConnectionControlChange} from './kids-source-control';
import {originalKidsConnectionControl} from './kids-source-control-state';
import {readKidsSourceSetup} from './kids-source-setup-state';
import {prepareSourcePermission,sourcePermissionStatements,originalSourcePermission,type SourcePermissionChange} from './kids-source-permissions';
import {readParentBoard,emptyParentBoard,guardParentChildren,prepareParentChange,parentStatements,parentOriginalResult,parentRecords,type ParentChange} from './kids-parent-store';
import {boardPreferencesSchema,defaultBoardPreferences,type BoardPreferences} from './kids-board-preferences';
import {readBoardPreferences,boardPreferenceStatement,boardPreferenceResult} from './kids-board-preferences-store';
import {kidsNoticeProjection,prepareKidsNotice,kidsNoticeStatement,exportKidsNoticeReviews,type NoticeChange} from './kids-notices';
import {hostedSourceOutcomes,type HostedSourceOutcome} from './kids-source-outcomes';
import {exportGoogleCalendars,guardGoogleChildren} from './kids-google-store';
import {schoolSummary,exportSchoolCalendars,guardSchoolChildren} from './kids-school-store';
import {guardSchoolSourceSupport,prepareSchoolSources,schoolSourceStatements,type SchoolSourceValue} from './kids-school-sources';
import {historyCoverage} from './kids-hosted-history';
import {hostedConnectionState,noRemovalSql,connectionRemovalGuard} from './kids-hosted-removal-state';
import {batchFence,sourceFence,sourceReconciliation,type BatchAuthority} from './kids-hosted-batch-state';
import {env} from 'cloudflare:workers';
import {ownedInstallation} from './owned-installation';
import {billingNowSql as clock} from './stripe-provider';
import {z} from 'zod';
import {prepareKidsCatalogChoices,kidsRecommendationFreshness,type CatalogFence} from './kids-chat-recommendations';
import {exportKidsChatCatalog} from './kids-chat-catalog-state';
import {kidsHash} from './kids-hash';
import {insertKidsChatSources,hostedBatchSourceKeys} from './kids-source-connections';
import {kidsMessageSourceKey} from './kids-source-key';
export {kidsHash} from './kids-hash';
import {kidsSourceManagedTasks,kidsSourceStats,kidsSourceWindow,preserveKidsMediaGap,exportKidsSources,kidsSeenFingerprints,kidsSourceLinks,restoreKidsProvenance} from './kids-records';
import {kidsServiceStatus,requireKidsService,kidsServiceGuard,type ServiceStamp} from './kids-service';
import {KidsError,kidsMetadata,kidsNeedsUpgrade,kidsCoverageGaps,emptyKids,checkedKids,changeKids,suggestChats,ingestKids,metadataSchema,ingestSchema,type Kids} from './kids';

type Row={user_id:string;id:string;revision:number;document:string;operations:string;token_hash:string|null;epoch:number;write_times:string;updated_at:string;last_write_nonce:string};
type Receipt={hash:string};
export const hostedDiscoveryInput=z.object({operationId:z.string().uuid(),workspaceId:z.string().uuid(),baseRevision:z.number().int().min(1)}).strict();
type DiscoveryInput=z.infer<typeof hostedDiscoveryInput>;
export type HostedDiscoveryAuthority={bindingId:string;bindingRevision:number;applicationId:string;production:number;endpointId:string;scopeId:string;accountId:string;identityHash:string;consentVersion:string;epoch:number;service:ServiceStamp;configHash:string;partial:boolean;discoveredCount:number;syncStatus:string};
const cfg=()=>env as unknown as {DB:D1Database;FAMILY_OPS_KIDS_LIVE?:string;FAMILY_OPS_KIDS_HOSTED_SOURCE?:string};
const db=()=>{if(!cfg().DB)throw new KidsError('Kids storage is unavailable. Your earlier work is unchanged.',503);return cfg().DB;};
export const kidsLive=()=>cfg().FAMILY_OPS_KIDS_LIVE==='enabled';
const loadRaw=(user:string)=>db().prepare('SELECT * FROM kids_state WHERE user_id=?').bind(user).first<Row>();
function requireNormalized(row:Row){if(kidsNeedsUpgrade(checkedKids(JSON.parse(row.document)),row.operations))throw new KidsError('Kids storage upgrade is not finished. Earlier work is preserved; retry or export Kids data.',503);}
async function load(user:string){const row=await loadRaw(user);if(row)requireNormalized(row);return row;}
async function view(row:Row|null){const [service,stats,hostedConnection]=await Promise.all([kidsServiceStatus(row?.user_id??'',row?.id??null),row?kidsSourceStats(row.user_id,row.id):Promise.resolve({trackedMessageCount:0,sourceCounts:{}}),row?hostedConnectionState(db(),row.user_id,row.id):Promise.resolve({pending:false,canRemove:false})]);const notices=row?await kidsNoticeProjection(row.user_id,row.id):{};const sourceManagedTasks=row?[...await kidsSourceManagedTasks(row.user_id,row.id)]:[];const result={...stats,sourceManagedTasks,notices,parentActivities:row?await readParentBoard(row.user_id,row.id):emptyParentBoard(),boardPreferences:row?await readBoardPreferences(row.user_id,row.id):defaultBoardPreferences(),school:row?await schoolSummary(row.user_id,row.id):{drafts:0,calendars:0,issues:0},history:row?await historyCoverage(row.user_id,row.id,row.epoch):[],lastSavedInterpretationAt:row?await lastSavedInterpretationAt(row):null,service,hostedConnection,recommendationFreshness:row?await kidsRecommendationFreshness(row.user_id,checkedKids(JSON.parse(row.document))):{},workspace:row?checkedKids(JSON.parse(row.document)):null,revision:row?.revision??0,updatedAt:row?.updated_at??null,connectorKeySet:!!row?.token_hash,liveEnabled:kidsLive()&&service.active,hostedSetupEnabled:kidsLive()&&service.active&&cfg().FAMILY_OPS_KIDS_HOSTED_SOURCE==='unipile-v2'};const sourceConnections=row?await readKidsSourceSetup(row.user_id,row.id):null;if(row&&sourceConnections?.boardRevision!==row.revision)throw new KidsError('Kids changed while reading. Reopen the saved board.',409);return {...result,sourceConnections};}
async function lastSavedInterpretationAt(row:Row){
 const receipt=await db().prepare("SELECT MAX(created_at) millis FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND CASE WHEN json_valid(source_authority) THEN json_extract(source_authority,'$.kind')='hosted-source-batch-v1' ELSE 0 END").bind(row.user_id,row.id).first<{millis:number|null}>();
 return receipt?.millis?new Date(receipt.millis).toISOString():null;
}
export async function getKids(user:string){const access=await resolveKidsAccess(user);return access&&access.role!=='owner'?kidsMemberView(access):readKids(user);}
export async function readKids(user:string){requireKidsOwner(user);return view(await load(user));}
async function cleanDeletions(user:string){await db().prepare('DELETE FROM kids_deletions WHERE user_id=? AND deleted_at<?').bind(user,Date.now()-30*86400000).run();}
const envelope=z.object({operationId:z.string().uuid(),workspaceId:z.string().uuid().optional(),baseRevision:z.number().int().min(0),type:z.string().max(40),args:z.unknown()}).strict();
function limits(row:Row|null){const writes=row?(JSON.parse(row.write_times) as number[]).filter(t=>t>Date.now()-60000):[];if(writes.length>=120)throw new KidsError('Too many changes in a minute. Wait a minute and retry this same change.',429);writes.push(Date.now());return writes;}
const previousReceipt=(user:string,workspace:string,operation:string)=>db().prepare('SELECT body_hash AS hash FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,workspace,operation).first<Receipt>();
async function commit(row:Row|null,user:string,k:Kids,operationId:string,hash:string,tokenHash:string|null,guard?:{hash:string;epoch:number},service?:ServiceStamp,hosted?:HostedDiscoveryAuthority,batch?:BatchAuthority,schoolValues:SchoolSourceValue[]=[],catalogFence?:CatalogFence,outcomes?:HostedSourceOutcome[],notice?:NoticeChange,preferences?:BoardPreferences,parent?:ParentChange,sourcePermission?:SourcePermissionChange,connectionControl?:ConnectionControlChange,parentItem?:ParentItemReceipt,member?:KidsAccess){
 checkedKids(k);const sources=JSON.stringify(k.sources),document=JSON.stringify(kidsMetadata(k)),links=JSON.stringify(kidsSourceLinks(k)),now=new Date().toISOString(),writes=JSON.stringify(limits(row)),nonce=crypto.randomUUID(),permission=service?kidsServiceGuard(service):null,removal=batch?connectionRemovalGuard(batch.bindingId):hosted?connectionRemovalGuard(hosted.bindingId):catalogFence||sourcePermission||connectionControl?{sql:'1',values:[]}:connectionRemovalGuard();
 let change:D1PreparedStatement;
 if(row){const sql="UPDATE kids_state SET document=?,operations='{}',token_hash=?,epoch=?,write_times=?,revision=revision+1,updated_at=?,last_write_nonce=? WHERE user_id=? AND id=? AND revision=?"+(member?' AND '+kidsMemberFence(member).sql:'')+(guard?' AND token_hash=? AND epoch=?':'')+(permission?' AND '+permission.sql+' AND '+removal.sql:'')+(batch?' AND '+sourceFence(user,k.id,batch).sql+' AND '+batchFence(batch).sql:'')+(catalogFence?' AND '+catalogFence.sql:'')+(sourcePermission?' AND '+sourcePermission.fence.sql:'')+(connectionControl?' AND '+connectionControl.fence.sql:'')+(notice?' AND '+notice.fence.sql:'')+(parent?' AND '+parent.fence.sql:'')+(hosted?" AND epoch=? AND json_extract(document,'$.mode')='live' AND json_extract(document,'$.discoveryConsent')=1 AND EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.id=? AND b.owner_user_id=kids_state.user_id AND b.workspace_id=kids_state.id AND b.revision=? AND b.active=1 AND b.application_id=? AND b.production=? AND b.endpoint_id=? AND b.scope_id=? AND b.account_id=? AND b.provider_identity_hash=? AND b.consent_version=?)":'')+' RETURNING *';const values:(string|number|null)[]=[document,tokenHash,k.epoch,writes,now,nonce,user,row.id,row.revision];if(member)values.push(...kidsMemberFence(member).values);if(guard)values.push(guard.hash,guard.epoch);if(permission)values.push(...permission.values,...removal.values);if(batch)values.push(...sourceFence(user,k.id,batch).values,...batchFence(batch).values);if(catalogFence)values.push(...catalogFence.values);if(sourcePermission)values.push(...sourcePermission.fence.values);if(connectionControl)values.push(...connectionControl.fence.values);if(notice)values.push(...notice.fence.values);if(parent)values.push(...parent.fence.values);if(hosted)values.push(hosted.epoch,hosted.bindingId,hosted.bindingRevision,hosted.applicationId,hosted.production,hosted.endpointId,hosted.scopeId,hosted.accountId,hosted.identityHash,hosted.consentVersion);change=db().prepare(sql).bind(...values);}
 else change=db().prepare("INSERT INTO kids_state(user_id,id,revision,document,operations,token_hash,epoch,write_times,updated_at,last_write_nonce) VALUES(?,?,1,?,'{}',?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING RETURNING *").bind(user,k.id,document,tokenHash,k.epoch,writes,now,nonce);
 const active='EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?)';
 const owned=ownedInstallation();
 const results=await db().batch([
  change,
  ...(!row&&owned.kind==='owned'&&owned.ownerId===user?[db().prepare(`INSERT INTO kids_service_access(owner_user_id,workspace_id,grant_id,revision,kind,beta_until,billing_workspace_id,revoked_at,created_at,updated_at) SELECT user_id,id,?,1,'owned',NULL,NULL,NULL,${clock},${clock} FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?`).bind(owned.installationId,user,k.id,nonce)]:[]),
  db().prepare(`INSERT INTO kids_source_records(owner_user_id,workspace_id,source_key,message_id,chat_id,context_id,fingerprint,unread_media,source_json) SELECT ?,?,json_extract(s.value,'$.key'),json_extract(s.value,'$.id'),json_extract(s.value,'$.chatId'),json_extract(s.value,'$.contextId'),json_extract(s.value,'$.fingerprint'),json_extract(s.value,'$.unreadMedia'),s.value FROM json_each(?) s WHERE ${active} ON CONFLICT(owner_user_id,workspace_id,source_key) DO UPDATE SET message_id=excluded.message_id,chat_id=excluded.chat_id,context_id=excluded.context_id,fingerprint=excluded.fingerprint,unread_media=excluded.unread_media,source_json=excluded.source_json`).bind(user,k.id,sources,user,k.id,nonce),
  db().prepare(`INSERT INTO kids_source_links(owner_user_id,workspace_id,context_id,task_id,source_key) SELECT ?,?,json_extract(l.value,'$.contextId'),json_extract(l.value,'$.taskId'),json_extract(l.value,'$.sourceKey') FROM json_each(?) l WHERE ${active} ON CONFLICT(owner_user_id,workspace_id,context_id,task_id,source_key) DO NOTHING`).bind(user,k.id,links,user,k.id,nonce),
  ...(batch?[
   db().prepare(`UPDATE kids_hosted_batches SET status='saved',submitted_hash=?,committed_revision=(SELECT revision FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?) WHERE id=? AND owner_user_id=? AND workspace_id=? AND status='ready' AND ${active}`).bind(batch.interpretationHash,user,k.id,nonce,batch.batchId,user,k.id,user,k.id,nonce),
  ]:[]),
  db().prepare(`INSERT INTO kids_operation_receipts(owner_user_id,workspace_id,operation_id,body_hash,committed_revision,created_at,source_authority) SELECT user_id,id,?,?,revision,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),? FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?`).bind(operationId,hash,batch?JSON.stringify({kind:'hosted-source-batch-v1',chatId:batch.chatId,...(batch.providerChatId!==undefined?{providerChatId:batch.providerChatId,connectionEpoch:batch.connectionEpoch}:{}),outcomeVersion:1,outcomes,sourceKind:batch.versions[0]?.origin??'webhook',batchId:batch.batchId,bindingId:batch.bindingId,bindingRevision:batch.bindingRevision,epoch:batch.epoch,service:batch.service,configHash:batch.configHash,sourceCount:batch.versions.length}):hosted?JSON.stringify({kind:'hosted-chat-discovery-v1',bindingId:hosted.bindingId,bindingRevision:hosted.bindingRevision,epoch:hosted.epoch,service:hosted.service,configHash:hosted.configHash,applicationId:hosted.applicationId,production:hosted.production,endpointId:hosted.endpointId,consentVersion:hosted.consentVersion,partial:hosted.partial,discoveredCount:hosted.discoveredCount,syncStatus:hosted.syncStatus}):notice?JSON.stringify(notice.receipt):preferences?JSON.stringify({kind:'parent-board-preferences-v1',preferences}):parent?JSON.stringify(parent.receipt):sourcePermission?JSON.stringify(sourcePermission.receipt):connectionControl?JSON.stringify(connectionControl.receipt):parentItem?JSON.stringify(parentItem):null,user,k.id,nonce),
  ...(member?[kidsManualAudit(member,operationId,parentItem?'parentItem':parent?'parentActivity':'task',nonce)]:[]),
  ...(notice?[kidsNoticeStatement(user,k.id,nonce,notice)]:[]),
  ...(preferences?[boardPreferenceStatement(user,k.id,nonce,operationId,preferences)]:[]),
  ...(parent?parentStatements(user,k.id,nonce,operationId,parent):[]),
  ...(sourcePermission?sourcePermissionStatements(db(),user,k.id,nonce,sourcePermission):[]),
  ...(connectionControl?kidsConnectionControlStatements(db(),user,k.id,nonce,operationId,connectionControl):[]),
  ...(catalogFence?.mappings?.length?[insertKidsChatSources(db(),catalogFence.mappings,{sql:active,values:[user,k.id,nonce]})]:[]),

  ...(batch?[

   ...(batch.versions[0]?.origin==='history'?[db().prepare(`INSERT INTO kids_hosted_history_heads(binding_id,chat_id,message_id,message_sequence,body_hash,fingerprint) SELECT ?,json_extract(v.value,'$.chatId'),json_extract(v.value,'$.messageId'),json_extract(v.value,'$.sequence'),json_extract(v.value,'$.bodyHash'),json_extract(v.value,'$.fingerprint') FROM json_each(?) v WHERE ${active} AND ((json_extract(v.value,'$.priorHistorySequence') IS NULL AND NOT EXISTS(SELECT 1 FROM kids_hosted_history_heads h WHERE h.binding_id=? AND h.chat_id=json_extract(v.value,'$.chatId') AND h.message_id=json_extract(v.value,'$.messageId'))) OR EXISTS(SELECT 1 FROM kids_hosted_history_heads h WHERE h.binding_id=? AND h.chat_id=json_extract(v.value,'$.chatId') AND h.message_id=json_extract(v.value,'$.messageId') AND h.message_sequence=json_extract(v.value,'$.priorHistorySequence') AND h.body_hash=json_extract(v.value,'$.priorHistoryHash'))) ON CONFLICT(binding_id,chat_id,message_id) DO UPDATE SET message_sequence=excluded.message_sequence,body_hash=excluded.body_hash,fingerprint=excluded.fingerprint WHERE kids_hosted_history_heads.message_sequence<excluded.message_sequence`).bind(batch.bindingId,JSON.stringify(batch.versions),user,k.id,nonce,batch.bindingId,batch.bindingId),db().prepare(`UPDATE kids_hosted_history_messages SET raw_body=NULL,raw_bytes=0,consumed_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE sequence IN (SELECT message_sequence FROM kids_hosted_history_batch_members WHERE batch_id=?) AND consumed_at IS NULL AND ${active}`).bind(batch.batchId,user,k.id,nonce)]:[db().prepare(`INSERT INTO kids_hosted_message_heads(binding_id,chat_id,message_id,event_millis,event_sequence,fingerprint) SELECT ?,json_extract(v.value,'$.chatId'),json_extract(v.value,'$.messageId'),json_extract(v.value,'$.eventMillis'),json_extract(v.value,'$.sequence'),json_extract(v.value,'$.fingerprint') FROM json_each(?) v WHERE ${active} ON CONFLICT(binding_id,chat_id,message_id) DO UPDATE SET event_millis=excluded.event_millis,event_sequence=excluded.event_sequence,fingerprint=excluded.fingerprint`).bind(batch.bindingId,JSON.stringify(batch.versions),user,k.id,nonce),
   db().prepare(`UPDATE kids_hosted_events SET raw_body=NULL,raw_bytes=0,consumed_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE sequence IN (SELECT event_sequence FROM kids_hosted_batch_members WHERE batch_id=?) AND consumed_at IS NULL AND ${active}`).bind(batch.batchId,user,k.id,nonce)]),
  ]:[]),
  ...(batch?schoolSourceStatements(user,k.id,nonce,schoolValues,k.sources.map(s=>s.key)):[]),
 ]);
 const saved=results[0].results[0] as Row|undefined;if(!saved)throw new KidsError('The Kids workspace, source permission or service access changed. Reload before retrying.',409);return view(saved);
}
export const kidsHostedDiscoveryHash=(e:DiscoveryInput)=>kidsHash(JSON.stringify(['hosted-chat-discovery-v1',e.workspaceId,e.baseRevision]));
export async function retryKidsHostedDiscovery(user:string,e:DiscoveryInput){
 const row=await load(user);if(!row||row.id!==e.workspaceId)throw new KidsError('Open the current Kids workspace before discovering chats.',409);
 const receipt=await db().prepare('SELECT body_hash,committed_revision,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,e.workspaceId,e.operationId).first<{body_hash:string;committed_revision:number;source_authority:string|null}>();
 if(!receipt)return null;if(receipt.body_hash!==await kidsHostedDiscoveryHash(e)||!receipt.source_authority)throw new KidsError('That retry belongs to a different Kids change.',409);
 const outcome=z.object({kind:z.literal('hosted-chat-discovery-v1'),partial:z.boolean(),discoveredCount:z.number().int().min(0),syncStatus:z.string()}).parse(JSON.parse(receipt.source_authority));
 return {...await view(row),retried:true,discovery:{committedRevision:receipt.committed_revision,partial:outcome.partial,discoveredCount:outcome.discoveredCount,syncStatus:outcome.syncStatus,savedOutcome:true}};
}
export async function saveKidsHostedDiscovery(user:string,e:DiscoveryInput,metadata:z.infer<typeof metadataSchema>,authority:HostedDiscoveryAuthority){
 const old=await retryKidsHostedDiscovery(user,e);if(old)return old;
 const row=await load(user);if(!row||row.id!==e.workspaceId||row.revision!==e.baseRevision||row.epoch!==authority.epoch)throw new KidsError('Kids changed during chat discovery. Reopen the saved version before trying again.',409);
 const k=checkedKids(JSON.parse(row.document));suggestChats(k,metadata);if(k.step==='connect')k.step='chats';
 const gap='WhatsApp message history has not been reconciled; chat names do not confirm update coverage.';if(!k.connection.gaps.includes(gap))k.connection.gaps.push(gap);
 try{const saved=await commit(row,user,k,e.operationId,await kidsHostedDiscoveryHash(e),row.token_hash,undefined,authority.service,authority);return {...saved,discovery:{committedRevision:saved.revision,partial:authority.partial,discoveredCount:authority.discoveredCount,syncStatus:authority.syncStatus,savedOutcome:true}};}
 catch(error){if(error instanceof KidsError&&error.status===409){const raced=await retryKidsHostedDiscovery(user,e);if(raced)return raced;}throw error;}
}
export async function saveKidsHostedBatch(user:string,workspace:string,operation:string,hash:string,messages:z.infer<typeof ingestSchema>['messages'],authority:BatchAuthority){
 const row=await load(user);if(!row||row.id!==workspace)throw new KidsError('Open the current Kids board before saving updates.',409);
 if(messages.some(m=>m.chatId!==authority.chatId))throw sourceReconciliation();
 const sourceKeys=await hostedBatchSourceKeys(db(),user,workspace,authority.bindingId,authority.chatId,messages.map(m=>m.id));
 const k=checkedKids(JSON.parse(row.document)),links=(await db().prepare('SELECT context_id,task_id,source_key FROM kids_source_links WHERE owner_user_id=? AND workspace_id=? AND source_key IN ('+messages.map(()=>'?').join(',')+')').bind(user,workspace,...messages.map(m=>kidsMessageSourceKey(m.chatId,m.id,sourceKeys))).all<{context_id:string;task_id:string;source_key:string}>()).results;
 await guardSchoolSourceSupport(user,workspace,k,messages,authority,sourceKeys);
 for(const m of messages){const facts=m.facts===null?[]:Array.isArray(m.facts)?m.facts:[m.facts],key=kidsMessageSourceKey(m.chatId,m.id,sourceKeys);
  for(const link of links.filter(l=>l.source_key===key)){const context=k.contexts.find(c=>c.id===link.context_id);if(!context)throw sourceReconciliation();const fact=facts.find(f=>context.key===f.kind+':'+[...f.childIds].sort().join(',')+':'+f.contextKey);if(!fact)throw sourceReconciliation();if(link.task_id){const task=context.tasks.find(t=>t.id===link.task_id);if(!task||!fact.tasks.some(t=>t.key===task.key&&t.childId===task.childId))throw sourceReconciliation();}}
 }
 k.sources=await kidsSourceWindow(user,workspace,messages);const gaps=[...new Set([...k.connection.gaps,'Only approved queued updates were processed; message history has not been reconciled.'])];if(gaps.length>40)throw new KidsError('Source coverage needs review before more updates can be saved.',413);
 ingestKids(k,{messages,completeThrough:null,gaps},new Date().toISOString(),await kidsSourceManagedTasks(user,workspace),sourceKeys);await preserveKidsMediaGap(user,k);const schoolValues=await prepareSchoolSources(user,workspace,k,messages,authority,sourceKeys);
 return commit(row,user,checkedKids(k),operation,hash,row.token_hash,undefined,authority.service,undefined,authority,schoolValues,undefined,hostedSourceOutcomes(messages,authority.versions));
}
async function saveKidsMutation(user:string,input:unknown,surface:'web'|'assistant-v1'){
 requireKidsOwner(user);
  if(input&&typeof input==='object'&&'type'in input&&input.type==='parentItem')return saveParentItemMutation(user,input,surface);
  if(ownedInstallation().kind!=='shared'&&input&&typeof input==='object'&&'type'in input&&input.type==='connector')throw new KidsError('This private installation uses its hosted WhatsApp connection.',403);
  if(input&&typeof input==='object'&&'type' in input&&['recommendChats','addChatTitles'].includes(String(input.type)))return saveKidsCatalogMutation(user,input,surface);
  if(input&&typeof input==='object'&&'type'in input&&['parentActivity','manualStart'].includes(String(input.type)))return saveParentMutation(user,input,surface);
  if(surface==='web'&&input&&typeof input==='object'&&'type'in input&&input.type==='connectionControl')return saveKidsConnectionControl(user,input);
  if(input&&typeof input==='object'&&'type'in input&&input.type==='boardPreferences')return saveBoardPreferences(user,input,surface);
  if(surface==='web'&&input&&typeof input==='object'&&'type'in input&&['confirm','source'].includes(String(input.type))){const saved=await savePreparedSourcePermission(user,input);if(saved)return saved;}
  if(surface==='web'&&!(input&&typeof input==='object'&&'type'in input&&input.type==='contextCancellation'))await cleanDeletions(user);
  const e=envelope.parse(input);
  if(surface==='assistant-v1'&&!['interview','select','task','context','addTask','travel','notice','contextCancellation'].includes(e.type))throw new KidsError('This assistant operation is not supported.',403);
  const row=await load(user),body={type:e.type,args:e.args,workspaceId:e.workspaceId??null};
  const bodyHash=await kidsHash(JSON.stringify(surface==='assistant-v1'?{surface,baseRevision:e.baseRevision,...body}:body));
  const managed=e.type==='liveDiscovery'||e.type==='connector'||row&&JSON.parse(row.document).mode==='live'&&(e.type==='confirm'||e.type==='source'&&(e.args as {enabled?:unknown})?.enabled===true);
  if(managed&&!kidsLive())throw new KidsError('Live Kids connections are not enabled.',403);
  const service=managed&&row?await requireKidsService(user,row.id):undefined;
  if(row&&await db().prepare('SELECT 1 ok FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=? LIMIT 1').bind(user,row.id,e.operationId,user,row.id,e.operationId).first())throw new KidsError('Use a new operation ID; that ID belongs to a source collection.',409);
  if(row){const old=await previousReceipt(user,row.id,e.operationId);if(old){if(old.hash!==bodyHash)throw new KidsError('That retry belongs to a different Kids change.',409);return {...await view(row),retried:true};}if(e.workspaceId!==row.id)throw new KidsError('Open the current Kids workspace before saving.',403);if(e.baseRevision!==row.revision)throw new KidsError('Kids changed in another tab. Reload before saving this entry.',409);}
  else if(e.baseRevision!==0||e.workspaceId||!['profile','interview'].includes(e.type))throw new KidsError('Start the Kids interview first.',409);
  if(row&&['liveDiscovery','connector','confirm','source','disconnect'].includes(e.type)&&!await db().prepare(`SELECT 1 AS yes FROM kids_state WHERE user_id=? AND id=? AND ${noRemovalSql}`).bind(user,row.id).first())throw new KidsError('Finish the saved WhatsApp removal before changing source connections. Your board and manual changes remain available.',409);
  let k=row?checkedKids(JSON.parse(row.document)):emptyKids(),tokenHash=row?.token_hash??null;
  if(e.type==='notice'){if(!row)throw new KidsError('Open a saved notice first.',409);const notice=await prepareKidsNotice(user,k,e.operationId,e.args);try{return await commit(row,user,k,e.operationId,bodyHash,tokenHash,undefined,undefined,undefined,undefined,[],undefined,undefined,notice);}catch(error){if(error instanceof KidsError&&error.status===409){const prior=await previousReceipt(user,row.id,e.operationId);if(prior?.hash===bodyHash)return {...await readKids(user),retried:true};}throw error;}}
  if(row&&k.mode==='live'&&(e.type==='confirm'||e.type==='source'&&(e.args as {enabled?:unknown})?.enabled===true)&&await db().prepare('SELECT 1 AS yes FROM kids_hosted_removals WHERE owner_user_id=? AND workspace_id=? LIMIT 1').bind(user,row.id).first()&&!await db().prepare("SELECT 1 AS yes FROM kids_hosted_bindings WHERE owner_user_id=? AND workspace_id=? AND active=1 AND removed_at IS NULL AND ?='hosted:'||id AND ?='hosted-self:'||id").bind(user,row.id,k.connection.accountId,k.connection.selfUserId).first())throw new KidsError('Reconnect and verify WhatsApp, then review its current chats before resuming tracking.',403);
  if(e.type==='liveDiscovery'&&k.mode==='practice'&&row&&(await kidsSourceStats(user,row.id)).trackedMessageCount)throw new KidsError('Export and delete the practice Kids workspace before connecting real sources.');
  if(e.type==='reopenSavedBoard'){
    z.object({}).strict().parse(e.args);if(!row||!await db().prepare('SELECT 1 AS yes FROM kids_hosted_removals WHERE owner_user_id=? AND workspace_id=? AND paused_revision<=? LIMIT 1').bind(user,row.id,row.revision).first())throw new KidsError('No saved connection-removal board is available to reopen.',409);k.step='board';
  }else if(e.type==='connector'){
    const a=z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.number().int(),computerCode:z.string().regex(/^[A-F0-9]{12}$/)}).strict().parse(e.args);
    if(a.expiresAt<=Date.now()||a.expiresAt>Date.now()+10*60*1000||a.computerCode!==a.hash.slice(0,12).toUpperCase())throw new KidsError('This computer approval expired or its code does not match. Open a new connection from Family Ops setup.',409);
    if(!kidsLive()||k.mode!=='live'||!k.discoveryConsent)throw new KidsError('Live WhatsApp setup is not enabled or discovery was not approved.',403);tokenHash=a.hash;k.epoch++;
  }else{const regeneratesPractice=k.mode==='practice'&&(e.type==='confirm'||e.type==='source'&&(e.args as {enabled?:unknown}|null)?.enabled===true);const sourceManaged=regeneratesPractice&&row?await kidsSourceManagedTasks(user,row.id):undefined;k=changeKids(k,e.type,e.args,kidsLive(),sourceManaged);if(e.type==='disconnect')tokenHash=null;}
  if(row&&['profile','interview'].includes(e.type)){await guardSchoolChildren(user,row.id,k);await guardGoogleChildren(user,row.id,k);await guardParentChildren(user,k);}
  if(row)await preserveKidsMediaGap(user,k);
  return commit(row,user,k,e.operationId,bodyHash,tokenHash,undefined,service);
}
export async function saveKidsMemberMutation(access:KidsAccess,input:unknown,surface:'web'|'assistant-v1'){
 const e=envelope.extend({grantId:z.string().uuid(),grantRevision:z.number().int().min(1)}).parse(input);assertKidsMemberBinding(access,e);
 const row=await load(access.ownerId);if(!row||row.id!==access.workspaceId)throw new KidsError('Shared organizer access changed.',403);
 const k=checkedKids(JSON.parse(row.document));await assertManualMemberCommand(access,k,e.type,e.args);
 const hash=await kidsHash(JSON.stringify(['member-manual-v1',surface,access.actorId,access.installationId,access.grantId,access.grantRevision,e.baseRevision,e.type,e.args]));
 const original=async()=>{await recheckKidsAccess(access);const prior=await db().prepare('SELECT body_hash,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(access.ownerId,row.id,e.operationId).first<{body_hash:string;source_authority:string|null}>();if(!prior)return null;if(prior.body_hash!==hash)throw new KidsError('That operation belongs to another actor or change.',409);return prior.source_authority?JSON.parse(prior.source_authority):{};};
 const response=async(receipt:Record<string,unknown>,retried=false)=>({...await kidsMemberView(access),...(receipt.kind==='parent-item-v1'?{parentItemResult:receipt.result}:{}),...(receipt.kind==='parent-activity-v1'?{manualResult:receipt.result}:{}),retried});
 const prior=await original();if(prior)return response(prior,true);if(row.revision!==e.baseRevision)throw new KidsError('The shared organizer changed. Keep your draft and reopen before reconciling.',409);
 let next=k,parent:ParentChange|undefined,item:ParentItemReceipt|undefined;
 if(e.type==='parentItem'){const a=z.object({command:z.unknown()}).strict().parse(e.args),changed=changeParentItem(k,a.command,e.operationId);next=changed.kids;item=changed.receipt;}
 else if(e.type==='parentActivity'){const a=z.object({command:z.unknown()}).strict().parse(e.args);parent=await prepareParentChange(access.ownerId,k,a.command);}
 else next=changeKids(k,e.type,e.args,false);
 try{await commit(row,access.ownerId,next,e.operationId,hash,row.token_hash,undefined,undefined,undefined,undefined,[],undefined,undefined,undefined,undefined,parent,undefined,undefined,item,access);return response(item??parent?.receipt??{});}
 catch(error){if(error instanceof KidsError&&error.status===409){const old=await original();if(old)return response(old,true);}throw error;}
}
async function saveParentItemMutation(user:string,input:unknown,surface:'web'|'assistant-v1'){
 const e=envelope.parse(input),a=z.object({command:z.unknown()}).strict().parse(e.args),row=await load(user);
 if(!row||row.id!==e.workspaceId)throw new KidsError('Open your saved board before adding an item.',403);
 const hash=await kidsHash(JSON.stringify(['parent-item-v1',surface,e.workspaceId,e.baseRevision,e.args]));
 const original=async()=>{const old=await db().prepare('SELECT body_hash,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,row.id,e.operationId).first<{body_hash:string;source_authority:string|null}>();if(!old)return null;if(old.body_hash!==hash)throw new KidsError('That retry belongs to a different parent item.',409);const value=old.source_authority?JSON.parse(old.source_authority) as ParentItemReceipt:null;if(value?.kind!=='parent-item-v1')throw new KidsError('That operation belongs to another change.',409);return value.result;};
 const prior=await original();if(prior)return {...await readKids(user),parentItemResult:prior,retried:true};
 if(row.revision!==e.baseRevision)throw new KidsError('Your board changed. Reopen the saved version before saving this item.',409);
 if(await db().prepare('SELECT 1 ok FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=? LIMIT 1').bind(user,row.id,e.operationId,user,row.id,e.operationId).first())throw new KidsError('Use a new operation ID for this parent item.',409);
 const changed=changeParentItem(checkedKids(JSON.parse(row.document)),a.command,e.operationId);
 try{const saved=await commit(row,user,changed.kids,e.operationId,hash,row.token_hash,undefined,undefined,undefined,undefined,[],undefined,undefined,undefined,undefined,undefined,undefined,undefined,changed.receipt);return {...saved,parentItemResult:changed.receipt.result};}
 catch(error){if(error instanceof KidsError&&error.status===409){const prior=await original();if(prior)return {...await readKids(user),parentItemResult:prior,retried:true};}throw error;}
}
async function savePreparedSourcePermission(user:string,input:unknown){
 const e=envelope.parse(input),row=await load(user);if(!row)return null;
 if(e.workspaceId!==row.id)throw new KidsError('Open your current Kids workspace before changing source permission.',403);
 const hash=await kidsHash(JSON.stringify(['kids-source-permission-v1','web',e.type,e.workspaceId,e.baseRevision,e.args]));
 const old=await db().prepare('SELECT body_hash,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,row.id,e.operationId).first<{body_hash:string;source_authority:string|null}>();
 if(old){let kind='';try{kind=old.source_authority?JSON.parse(old.source_authority).kind:'';}catch{throw new KidsError('This saved operation needs review.',409);}if(kind!=='kids-source-permission-v1')return null;if(old.body_hash!==hash)throw new KidsError('That retry belongs to a different source-permission change.',409);return {...await readKids(user),permissionResult:await originalSourcePermission(user,row.id,e.operationId),retried:true};}
 if(!await db().prepare('SELECT 1 ok FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? LIMIT 1').bind(user,row.id).first())return null;
 if(e.baseRevision!==row.revision)throw new KidsError('Kids changed. Reopen its exact account and chat review.',409);
 if(await db().prepare('SELECT 1 ok FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_removals WHERE owner_user_id=? AND workspace_id=? AND operation_id=? LIMIT 1').bind(...Array.from({length:4},()=>[user,row.id,e.operationId]).flat()).first())throw new KidsError('Use a new operation ID for this source review.',409);
 const prepared=await prepareSourcePermission(user,checkedKids(JSON.parse(row.document)),e.type as 'confirm'|'source',e.args);
 if(prepared.enabling&&!kidsLive())throw new KidsError('Live Kids connections are not enabled.',403);
 const service=prepared.enabling?await requireKidsService(user,row.id):undefined;
 try{const saved=await commit(row,user,prepared.kids,e.operationId,hash,row.token_hash,undefined,service,undefined,undefined,[],undefined,undefined,undefined,undefined,undefined,prepared.change);return {...saved,permissionResult:await originalSourcePermission(user,row.id,e.operationId)};}
 catch(error){if(error instanceof KidsError&&error.status===409){const receipt=await previousReceipt(user,row.id,e.operationId);if(receipt?.hash===hash)return {...await readKids(user),permissionResult:await originalSourcePermission(user,row.id,e.operationId),retried:true};}throw error;}
}
async function saveParentMutation(user:string,input:unknown,surface:'web'|'assistant-v1'){
 const e=envelope.parse(input),row=await load(user);if(!row||row.id!==e.workspaceId)throw new KidsError('Open your saved board before changing parent-entered activities.',403);
 const hash=await kidsHash(JSON.stringify(['parent-activity-v1',surface,e.type,e.workspaceId,e.baseRevision,e.args]));
 const retry=async()=>{const old=await previousReceipt(user,row.id,e.operationId);if(!old)return null;if(old.hash!==hash)throw new KidsError('That retry belongs to another activity change.',409);return {...await readKids(user),manualResult:await parentOriginalResult(user,row.id,e.operationId),retried:true};};
 const prior=await retry();if(prior)return prior;if(e.baseRevision!==row.revision)throw new KidsError('Your board changed. Reopen it before changing the activity.',409);
 if(await db().prepare('SELECT 1 ok FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=? LIMIT 1').bind(user,row.id,e.operationId,user,row.id,e.operationId).first())throw new KidsError('Use a new operation ID for this parent change.',409);
 const k=checkedKids(JSON.parse(row.document));let parent:ParentChange;
 if(e.type==='manualStart'){
  z.object({}).strict().parse(e.args);if(k.mode==='live'||k.confirmedAt||k.discoveryConsent||k.processingConsent||k.candidates.length||k.grants.length||k.contexts.length||k.sources.length||row.token_hash||(await kidsSourceStats(user,row.id)).trackedMessageCount)throw new KidsError('This workspace already has source setup or example content. Keep that work and open its board; do not mix it with a new manual setup.',409);
  if(!k.children.length||k.children.some(c=>!c.name||c.age===null))throw new KidsError('Save each child’s name and age first.');k.mode='manual';k.step='board';
  const result={action:'manualStart',mode:'manual'};parent={result,receipt:{kind:'parent-activity-v1',result},fence:{sql:'1=1',values:[]}};
 }else{const a=z.object({command:z.unknown()}).strict().parse(e.args);parent=await prepareParentChange(user,k,a.command);}
 try{const saved=await commit(row,user,k,e.operationId,hash,row.token_hash,undefined,undefined,undefined,undefined,[],undefined,undefined,undefined,undefined,parent);return {...saved,manualResult:await parentOriginalResult(user,row.id,e.operationId)};}
 catch(error){if(error instanceof KidsError&&error.status===409){const prior=await retry();if(prior)return prior;}throw error;}
}
async function saveBoardPreferences(user:string,input:unknown,surface:'web'|'assistant-v1'){
 const e=envelope.parse(input),args=z.object({preferences:boardPreferencesSchema}).strict().parse(e.args),row=await load(user);
 if(!row||row.id!==e.workspaceId)throw new KidsError('Open your saved board before customizing it.',403);
 const hash=await kidsHash(JSON.stringify(['parent-board-preferences-v1',surface,e.workspaceId,e.baseRevision,e.args]));
 const retry=async()=>{const old=await previousReceipt(user,row.id,e.operationId);if(!old)return null;if(old.hash!==hash)throw new KidsError('That retry belongs to a different board customization.',409);return {...await readKids(user),preferenceResult:await boardPreferenceResult(user,row.id,e.operationId),retried:true};};
 const prior=await retry();if(prior)return prior;
 if(e.baseRevision!==row.revision)throw new KidsError('Your board changed. Reopen the saved version before customizing it.',409);
 if(await db().prepare('SELECT 1 ok FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=? LIMIT 1').bind(user,row.id,e.operationId,user,row.id,e.operationId).first())throw new KidsError('Use a new operation ID for this customization.',409);
 try{const saved=await commit(row,user,checkedKids(JSON.parse(row.document)),e.operationId,hash,row.token_hash,undefined,undefined,undefined,undefined,[],undefined,undefined,undefined,args.preferences);return {...saved,preferenceResult:await boardPreferenceResult(user,row.id,e.operationId)};}
 catch(error){if(error instanceof KidsError&&error.status===409){const prior=await retry();if(prior)return prior;}throw error;}
}
async function saveKidsCatalogMutation(user:string,input:unknown,surface:'web'|'assistant-v1'){
 const e=envelope.parse(input);
 if(e.type==='recommendChats'?surface!=='assistant-v1':e.type!=='addChatTitles'||surface!=='web')throw new KidsError('Use the parent title chooser or native recommendation tool for this change.',403);
 const row=await load(user);if(!row||row.id!==e.workspaceId)throw new KidsError('Open your current Kids workspace before reviewing titles.',409);
 const hash=await kidsHash(JSON.stringify(['kids-catalog-choice-v1',surface,e.type,e.workspaceId,e.baseRevision,e.args]));
 const retry=async()=>{const saved=await previousReceipt(user,row.id,e.operationId);if(!saved)return null;if(saved.hash!==hash)throw new KidsError('That retry belongs to another Kids change.',409);return {...await readKids(user),retried:true};};
 const prior=await retry();if(prior)return prior;
 if(row.revision!==e.baseRevision)throw new KidsError('Kids changed. Reopen its saved interview and title choices before saving.',409);
 if(!kidsLive())throw new KidsError('Live Kids connections are not enabled.',403);
 if(await db().prepare('SELECT 1 ok FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=? LIMIT 1').bind(user,row.id,e.operationId,user,row.id,e.operationId).first())throw new KidsError('Use a new operation ID; this one belongs to source collection.',409);
 const service=await requireKidsService(user,row.id,false),prepared=await prepareKidsCatalogChoices(user,checkedKids(JSON.parse(row.document)),row.epoch,e.args,e.type as 'recommendChats'|'addChatTitles');
 try{return await commit(row,user,prepared.kids,e.operationId,hash,row.token_hash,undefined,service,undefined,undefined,[],prepared.fence);}
 catch(error){if(error instanceof KidsError&&error.status===409){const raced=await retry();if(raced)return raced;}throw error;}
}
export async function mutateKids(user:string,input:unknown){return saveKidsMutation(user,input,'web');}
export async function mutateKidsFromAssistant(user:string,input:unknown){return saveKidsMutation(user,input,'assistant-v1');}
const deletion=z.object({operationId:z.string().uuid(),workspaceId:z.string().uuid(),baseRevision:z.number().int().min(1),confirmed:z.literal(true)}).strict();
export async function deleteKids(user:string,input:unknown){requireKidsOwner(user);
  const e=deletion.parse(input);await cleanDeletions(user);
  const receipt=()=>db().prepare('SELECT workspace_id,base_revision FROM kids_deletions WHERE user_id=? AND operation_id=?').bind(user,e.operationId).first<{workspace_id:string;base_revision:number}>();
  const previous=await receipt();if(previous){if(previous.workspace_id!==e.workspaceId||previous.base_revision!==e.baseRevision)throw new KidsError('That deletion retry belongs to another Kids workspace.',409);return {...await getKids(user),deletedId:e.workspaceId,retried:true};}

  const result=await db().batch([
    db().prepare('INSERT INTO kids_deletions(user_id,operation_id,workspace_id,base_revision,deleted_at) SELECT user_id,?,id,revision,? FROM kids_state WHERE user_id=? AND id=? AND revision=? ON CONFLICT(user_id,operation_id) DO NOTHING').bind(e.operationId,Date.now(),user,e.workspaceId,e.baseRevision),
    db().prepare('DELETE FROM kids_state WHERE user_id=? AND id=? AND revision=? AND EXISTS(SELECT 1 FROM kids_deletions WHERE user_id=? AND operation_id=? AND workspace_id=? AND base_revision=?) RETURNING id').bind(user,e.workspaceId,e.baseRevision,user,e.operationId,e.workspaceId,e.baseRevision),
  ]);
  if(!result[1].results.length){const raced=await receipt();if(!raced||raced.workspace_id!==e.workspaceId||raced.base_revision!==e.baseRevision)throw new KidsError('Kids changed. Reload and confirm deletion again.',409);}
  await db().prepare('DELETE FROM kids_deletions WHERE rowid IN (SELECT rowid FROM kids_deletions WHERE deleted_at<? LIMIT 50)').bind(Date.now()-30*86400000).run();
  return {...await getKids(user),deletedId:e.workspaceId};
}
export async function kidsExport(user:string){requireKidsOwner(user);const row=await loadRaw(user);if(!row)throw new KidsError('No Kids workspace to export.',404);const stored=checkedKids(JSON.parse(row.document)),workspace=kidsNeedsUpgrade(stored,row.operations)?stored:await restoreKidsProvenance(user,{...stored,sources:await exportKidsSources(user,row.id)}),school=await exportSchoolCalendars(user,row.id),google=await exportGoogleCalendars(user,row.id),chatCatalog=await exportKidsChatCatalog(user,row.id),noticeReviews=await exportKidsNoticeReviews(user,row.id),boardPreferences=await readBoardPreferences(user,row.id),parentActivities=await parentRecords(user,row.id),current=await loadRaw(user);if(!current||current.id!==row.id||current.revision!==row.revision)throw new KidsError('Kids changed while exporting. Retry export to get one saved version.',409);return {format:'family-ops-kids',version:1,revision:row.revision,exportedAt:new Date().toISOString(),workspace,school,google,chatCatalog,noticeReviews,boardPreferences,parentActivities};}

async function bridgeRow(request:Request,refreshBilling=true){
  if(ownedInstallation().kind!=='shared')throw new KidsError('This private installation uses its hosted WhatsApp connection.',403);
  if(!kidsLive())throw new KidsError('Live Kids connections are not enabled.',403);
  if(request.headers.has('origin'))throw new KidsError('Use the local Kids companion for this connection.',403);
  const auth=request.headers.get('authorization')??'';if(!/^Bearer kids_[a-f0-9]{64}$/.test(auth))throw new KidsError('Reconnect the Kids companion.',401);
  const hash=await kidsHash(auth.slice(7));const row=await db().prepare('SELECT * FROM kids_state WHERE token_hash=?').bind(hash).first<Row>();if(!row)throw new KidsError('This Kids connection has ended. Reconnect in the app.',401);requireNormalized(row);
  const k=checkedKids(JSON.parse(row.document));if(k.mode!=='live'||!k.discoveryConsent)throw new KidsError('Source access has ended.',403);const service=await requireKidsService(row.user_id,row.id,refreshBilling);return {row,k,hash,service};
}
export async function getKidsBridge(request:Request){const {row,k,service}=await bridgeRow(request),sourceManaged=await kidsSourceManagedTasks(row.user_id,row.id);return {...await kidsSourceStats(row.user_id,row.id),serviceAccess:service,workspaceId:k.id,baseRevision:row.revision,epoch:k.epoch,accountId:k.connection.accountId,selfUserId:k.connection.selfUserId,children:k.children,language:k.language,exclusions:k.exclusions,discoveryAllowed:k.discoveryConsent,processingAllowed:k.processingConsent,grants:k.grants,sourceLookupRequired:true,compoundFactsAllowed:true,taskOwnershipAllowed:true,scheduleFieldsAllowed:true,seen:[],gaps:k.connection.gaps,lastSync:k.connection.lastSync,contexts:k.contexts.map(c=>({id:c.id,date:c.date,...(c.event?{event:c.event}:{}),...(c.routineKey?{routineKey:c.routineKey}:{}),...(c.travel?{travel:c.travel}:{}),notes:c.notes,words:c.words,missingMaterial:c.missingMaterial,pinned:c.pinned,filed:c.filed,key:c.key.slice(c.key.indexOf(':',c.key.indexOf(':')+1)+1),title:c.title,kind:c.kind,...(c.workflow?{workflow:c.workflow}:{}),childIds:c.childIds,tasks:c.tasks.map(t=>({id:t.id,key:t.key,title:t.title,childId:t.childId,due:t.due,sourceManaged:sourceManaged.has(c.id+':'+t.id),acknowledgedAt:t.acknowledgedAt,resolution:t.resolution}))})),completeThrough:k.connection.completeThrough};}
const bridgeEnvelope=z.object({operationId:z.string().uuid(),workspaceId:z.string().uuid(),baseRevision:z.number().int().min(1),epoch:z.number().int().min(0),serviceAccess:z.object({grantId:z.string().uuid(),revision:z.number().int().min(1)}).strict(),type:z.enum(['metadata','ingest','status']),data:z.unknown()}).strict();
export async function postKidsBridge(request:Request,input:unknown){
  const {row,k,hash,service}=await bridgeRow(request),e=bridgeEnvelope.parse(input);if(e.workspaceId!==k.id||e.epoch!==k.epoch||e.serviceAccess.grantId!==service.grantId||e.serviceAccess.revision!==service.revision)throw new KidsError('The approved source scope changed. Recheck it before reading more.',409);
  const bodyHash=await kidsHash(JSON.stringify({workspaceId:e.workspaceId,epoch:e.epoch,serviceAccess:e.serviceAccess,type:e.type,data:e.data}));const old=await previousReceipt(row.user_id,row.id,e.operationId);if(old){if(old.hash!==bodyHash)throw new KidsError('That source retry belongs to different data.',409);return {ok:true,retried:true,revision:row.revision};}if(e.baseRevision!==row.revision)throw new KidsError('Kids changed. Recheck the current scope before retrying.',409);
  if(e.type==='metadata')suggestChats(k,metadataSchema.parse(e.data));
  if(e.type==='ingest'){const data=ingestSchema.parse(e.data);k.sources=await kidsSourceWindow(row.user_id,row.id,data.messages);ingestKids(k,data,new Date().toISOString(),await kidsSourceManagedTasks(row.user_id,row.id));}
  if(e.type==='status'){const a=z.object({gaps:z.array(z.string().max(200)).max(40)}).strict().parse(e.data);k.connection.gaps=kidsCoverageGaps(k,a.gaps);k.connection.lastSync=new Date().toISOString();}
  await preserveKidsMediaGap(row.user_id,k);
  const saved=await commit(row,row.user_id,checkedKids(k),e.operationId,bodyHash,row.token_hash,{hash,epoch:e.epoch},service);return {ok:true,revision:saved.revision};
}
const seenInput=z.object({workspaceId:z.string().uuid(),epoch:z.number().int().min(0),serviceAccess:z.object({grantId:z.string().uuid(),revision:z.number().int().min(1)}).strict(),chatId:z.string().min(1).max(180),ids:z.array(z.string().min(1).max(180)).min(1).max(50)}).strict();
export async function readKidsSeen(request:Request,input:unknown){
 const a=seenInput.parse(input),before=await bridgeRow(request,false);
 const check=(current:Awaited<ReturnType<typeof bridgeRow>>)=>{if(a.workspaceId!==current.k.id||a.epoch!==current.k.epoch||a.serviceAccess.grantId!==current.service.grantId||a.serviceAccess.revision!==current.service.revision)throw new KidsError('The source or service scope changed. Recheck before reading.',409);if(!current.k.processingConsent||!current.k.grants.some(g=>g.enabled&&g.chatId===a.chatId))throw new KidsError('This chat is not currently approved for tracking.',403);};
 check(before);if(new Set(a.ids).size!==a.ids.length)throw new KidsError('Look up each source message only once.');const seen=await kidsSeenFingerprints(before.row.user_id,before.row.id,a.chatId,a.ids);check(await bridgeRow(request,false));return {workspaceId:before.k.id,epoch:before.k.epoch,serviceAccess:before.service,seen};
}

export async function kidsBody(request:Request){
  if(!request.headers.get('content-type')?.toLowerCase().includes('application/json'))throw new KidsError('Use JSON for this change.',415);
  const reader=request.body?.getReader();if(!reader)throw new KidsError('This change is empty.');const parts:Uint8Array[]=[];let bytes=0;
  try{while(true){const p=await reader.read();if(p.done)break;bytes+=p.value.length;if(bytes>250*1024)throw new KidsError('This Kids change is too large. Nothing was saved.',413);parts.push(p.value);}}finally{await reader.cancel().catch(()=>{});}
  const all=new Uint8Array(bytes);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all)) as unknown;}catch{throw new KidsError('Check the Kids change format.');}
}
export function kidsError(error:unknown){if(error instanceof Error&&error.message.includes('KIDS_HOSTED_UNLINK_FIRST'))return {error:'Remove the hosted WhatsApp connection through Connection & your data before deleting Kids. Your saved board and export remain available.',status:409};if(error instanceof Error&&error.message.includes('KIDS_ACCOUNT_REMOVE_TOGETHER'))return {error:'Remove Kids through its current settings so the paired billing account is removed safely. Export first and settle cancellation.',status:409};if(error instanceof Error&&error.message.includes('BILLING_CHECKOUT_PENDING'))return {error:'Finish or cancel the existing checkout before removing Kids. Your board and export remain available.',status:409};if(error instanceof Error&&error.message.includes('BILLING_CANCEL_FIRST'))return {error:'Cancel and recheck the subscription before removing Kids. Removing a board does not cancel charges.',status:409};if(error instanceof KidsError)return {error:error.message,status:error.status};if(error instanceof z.ZodError)return {error:'Check the Kids fields and try again.',status:400};return {error:'Kids could not be saved or loaded. Earlier work is unchanged. Retry the same change.',status:503};}

// The transport is deliberately not part of the intent hash. A future bound
// assistant confirmation calls this exact command, never generic edit_kids_board.
export async function saveKidsConnectionControl(user:string,input:unknown){
 const e=envelope.parse(input);if(e.type!=='connectionControl')throw new KidsError('Use the exact WhatsApp account control.');
 const row=await load(user);if(!row||e.workspaceId!==row.id)throw new KidsError('Open your current Kids workspace before changing a WhatsApp account.',403);
 const hash=await kidsHash(JSON.stringify(['kids-connection-control-v1',e.workspaceId,e.baseRevision,e.args]));
 const prior=await previousReceipt(user,row.id,e.operationId);if(prior){if(prior.hash!==hash)throw new KidsError('That retry belongs to another saved change.',409);return {...await readKids(user),connectionControlResult:await originalKidsConnectionControl(db(),user,row.id,e.operationId),retried:true};}
 if(row.revision!==e.baseRevision)throw new KidsError('Kids changed. Reopen the current WhatsApp account settings.',409);
 const kids=checkedKids(JSON.parse(row.document));if(kidsNeedsUpgrade(kids,row.operations))throw new KidsError('Finish the Kids storage upgrade before changing an account.',503);
 if(await db().prepare('SELECT 1 ok FROM kids_hosted_auth WHERE owner_user_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_batches WHERE owner_user_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_history_pages WHERE owner_user_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_removals WHERE owner_user_id=? AND operation_id=? LIMIT 1').bind(...Array.from({length:4},()=>[user,e.operationId]).flat()).first())throw new KidsError('Use a new operation ID for this account control.',409);
 const prepared=await prepareKidsConnectionControl(user,kids,row.revision,e.operationId,e.args);
 if(prepared.enabling&&!kidsLive())throw new KidsError('Live WhatsApp connections are not enabled.',403);
 const service=prepared.enabling?await requireKidsService(user,row.id,false):undefined;
 const saved=await commit(row,user,prepared.kids,e.operationId,hash,row.token_hash,undefined,service,undefined,undefined,[],undefined,undefined,undefined,undefined,undefined,undefined,prepared.change);
 return {...saved,connectionControlResult:await originalKidsConnectionControl(db(),user,row.id,e.operationId),retried:false};
}
