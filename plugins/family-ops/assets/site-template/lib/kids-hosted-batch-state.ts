import {readKidsChatSource,readKidsSourceConnection} from './kids-source-connections';
import {providerChat,connectionEpoch,completeSourceIdentity,connectionSourceFence} from './kids-source-authority';
import {hostedMessageSchema,type HostedMessage} from './kids-hosted-history-protocol';
import {z} from 'zod';
import {KidsError,checkedKids,kidsNeedsUpgrade,type Kids} from './kids';
import {kidsHostedSettings,verifyKidsHostedAccount} from './kids-hosted-auth';
import {KIDS_HOSTED_CONSENT,kidsHostedAccountAlias,kidsHostedSelfAlias} from './kids-hosted-config';
import {requireKidsService,kidsServiceGuard,type ServiceStamp} from './kids-service';
import {billingNowSql as clock} from './stripe-provider';

export type SourceAuthority={providerChatId?:string;connectionEpoch?:number;attendanceAuthority?:'reported'|'school';bindingId:string;bindingRevision:number;applicationId:string;production:number;endpointId:string;scopeId:string;accountId:string;identityHash:string;consentVersion:string;epoch:number;service:ServiceStamp;configHash:string;chatId:string;childId:string;topic:string};
export type SourceVersion={origin?:'webhook'|'history';sequence:number;bodyHash:string;fingerprint:string;chatId:string;messageId:string;eventMillis:number;priorHistorySequence?:number|null;priorHistoryHash?:string|null};
export type BatchAuthority=SourceAuthority&{batchId:string;interpretationHash:string;historyAuthorityHash?:string;versions:SourceVersion[]};
export type BatchRow={source_kind:'webhook'|'history';id:string;owner_user_id:string;workspace_id:string;operation_id:string;request_hash:string;binding_id:string;binding_revision:number;config_hash:string;epoch:number;service_grant_id:string;service_revision:number;chat_id:string;child_id:string;topic:string;app_chat_id:string|null;connection_epoch:number;workspace_revision:number;created_at:number;expires_at:number;status:'ready'|'saved'|'superseded';submitted_hash:string|null;committed_revision:number|null;now:number};
export type EventRow={sequence:number;binding_id:string;binding_revision:number;application_id:string;event_id:string;event_type:string;event_created_at:string;event_millis:number;chat_id:string|null;message_id:string|null;body_hash:string;raw_body:string|null;raw_bytes:number;epoch:number;connection_epoch:number;consumed_at:number|null};
type Binding={id:string;owner_user_id:string;workspace_id:string;revision:number;active:number;scope_id:string;account_id:string;provider_identity_hash:string;application_id:string;production:number;endpoint_id:string;consent_version:string};
type Workspace={user_id:string;id:string;revision:number;epoch:number;document:string;operations:string;token_hash:string|null;write_times:string;last_write_nonce:string;updated_at:string};
export const sourceConflict=()=>new KidsError('Kids, source permission or service changed. Reopen the saved board before collecting another batch.',409);
export const sourceReconciliation=()=>new KidsError('This source correction needs review. Earlier messages, views and completed tasks are preserved; this batch was not saved.',409,'SOURCE_RECONCILIATION_REQUIRED');
export const hashSource=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
export async function sourceContext(user:string,workspace:string,chat:string,verifyAccount=false){
 const c=await kidsHostedSettings(),row=await c.DB.prepare('SELECT * FROM kids_state WHERE user_id=? AND id=?').bind(user,workspace).first<Workspace>();
 if(!row)throw sourceConflict();const k=checkedKids(JSON.parse(row.document));if(kidsNeedsUpgrade(k,row.operations))throw new KidsError('Kids storage upgrade is unfinished. Earlier work is kept.',503);
 const grant=k.grants.find(g=>g.enabled&&g.chatId===chat);
 if(k.mode!=='live'||!k.discoveryConsent||!k.processingConsent||!k.confirmedAt||!grant)throw new KidsError('Confirm this WhatsApp chat and its processing scope in Kids before reading messages.',403);
 const mapping=await readKidsChatSource(c.DB,user,workspace,chat),connection=mapping?await readKidsSourceConnection(c.DB,user,workspace,mapping.binding_id):null;
 if(mapping&&(!connection||connection.id!==mapping.binding_id||connection.status!=='connected'||!connection.discovery_consent||!connection.processing_consent||!connection.confirmed_at||connection.paused))throw new KidsError('This WhatsApp connection is paused or not confirmed for processing.',403);
 if(!mapping&&await c.DB.prepare('SELECT 1 ok FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? LIMIT 1').bind(user,workspace).first())throw sourceConflict();
 const bindings=(await c.DB.prepare('SELECT * FROM kids_hosted_bindings WHERE owner_user_id=? AND workspace_id=? AND removed_at IS NULL'+(mapping?' AND id=?':'')).bind(user,workspace,...(mapping?[mapping.binding_id]:[])).all<Binding>()).results;
 const b=bindings.length===1?bindings[0]:null;
 if(!b||!b.active||b.application_id!==c.UNIPILE_APPLICATION_ID||b.production!==Number(c.UNIPILE_ENVIRONMENT==='production')||b.endpoint_id!==c.channelId||b.consent_version!==KIDS_HOSTED_CONSENT||!b.provider_identity_hash||!mapping&&(k.connection.accountId!==kidsHostedAccountAlias(b.id)||k.connection.selfUserId!==kidsHostedSelfAlias(b.id)))throw sourceConflict();
 if(!k.candidates.some(candidate=>candidate.id===chat&&candidate.accountId===kidsHostedAccountAlias(b.id)))throw sourceConflict();
 const service=await requireKidsService(user,workspace,false);
 const authority:SourceAuthority={...(grant.attendanceAuthority?{attendanceAuthority:grant.attendanceAuthority}:{}),bindingId:b.id,bindingRevision:b.revision,applicationId:b.application_id,production:b.production,endpointId:b.endpoint_id,scopeId:b.scope_id,accountId:b.account_id,identityHash:b.provider_identity_hash,consentVersion:b.consent_version,epoch:k.epoch,service,configHash:c.fingerprint,chatId:grant.chatId,childId:grant.childId,topic:grant.topic,...(mapping&&(mapping.identity_kind!=='legacy'||connection!.source_epoch!==0)?{providerChatId:mapping.provider_chat_id,connectionEpoch:connection!.source_epoch}:{})};
 let accountSync:string|null=null;if(verifyAccount){try{({sync:accountSync}=await verifyKidsHostedAccount(c,{accountId:b.account_id,applicationId:b.application_id,scopeId:b.scope_id,identityHash:b.provider_identity_hash}));}catch{throw new KidsError('The hosted WhatsApp account could not be verified. No messages were released or saved.',503);}}
 return {c,row,k,b,authority,accountSync};
}
export type SourceContext=Awaited<ReturnType<typeof sourceContext>>;
export function sourceFence(user:string,workspace:string,a:SourceAuthority){
 const service=kidsServiceGuard(a.service),local=connectionSourceFence(a.bindingId,a.chatId,providerChat(a),connectionEpoch(a));
 if(!completeSourceIdentity(a))throw sourceConflict();
 return {sql:`kids_state.user_id=? AND kids_state.id=? AND kids_state.epoch=? AND json_extract(kids_state.document,'$.mode')='live' AND json_extract(kids_state.document,'$.discoveryConsent')=1 AND json_extract(kids_state.document,'$.processingConsent')=1 AND json_extract(kids_state.document,'$.confirmedAt') IS NOT NULL AND ${local.sql} AND EXISTS(SELECT 1 FROM json_each(kids_state.document,'$.candidates') candidate WHERE json_extract(candidate.value,'$.id')=? AND json_extract(candidate.value,'$.accountId')=?) AND EXISTS(SELECT 1 FROM json_each(kids_state.document,'$.grants') g WHERE json_extract(g.value,'$.chatId')=? AND json_extract(g.value,'$.childId')=? AND json_extract(g.value,'$.topic')=? AND json_extract(g.value,'$.enabled')=1 AND COALESCE(json_extract(g.value,'$.attendanceAuthority'),'reported')=?) AND EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.id=? AND b.owner_user_id=kids_state.user_id AND b.workspace_id=kids_state.id AND b.revision=? AND b.active=1 AND b.application_id=? AND b.production=? AND b.endpoint_id=? AND b.scope_id=? AND b.account_id=? AND b.provider_identity_hash=? AND b.consent_version=?) AND ${service.sql}`,values:[user,workspace,a.epoch,...local.values,a.chatId,kidsHostedAccountAlias(a.bindingId),a.chatId,a.childId,a.topic,a.attendanceAuthority??'reported',a.bindingId,a.bindingRevision,a.applicationId,a.production,a.endpointId,a.scopeId,a.accountId,a.identityHash,a.consentVersion,...service.values]};
}
export function sameSource(batch:BatchRow,a:SourceAuthority){
 if(batch.binding_id!==a.bindingId||batch.binding_revision!==a.bindingRevision||batch.config_hash!==a.configHash||batch.epoch!==a.epoch||batch.service_grant_id!==a.service.grantId||batch.service_revision!==a.service.revision||batch.chat_id!==providerChat(a)||(batch.app_chat_id??batch.chat_id)!==a.chatId||(batch.connection_epoch??0)!==connectionEpoch(a)||batch.child_id!==a.childId||batch.topic!==a.topic||batch.status!=='ready'||batch.expires_at<=batch.now)throw sourceConflict();
}
export async function recheckSource(s:SourceContext){
 const f=sourceFence(s.row.user_id,s.row.id,s.authority);if(!await s.c.DB.prepare(`SELECT 1 AS ok FROM kids_state WHERE ${f.sql}`).bind(...f.values).first())throw sourceConflict();
}
const id=z.string().min(1).max(180),message=hostedMessageSchema;
const event=z.object({id,created_at:z.string().datetime({offset:true}),application_id:id,application_production:z.boolean(),account_id:id,account_scope_id:id,account_provider:z.literal('whatsapp'),type:z.enum(['message.new','message.update']),payload:message});
export async function canonicalEvent(q:EventRow,a:SourceAuthority){
 if(!q.raw_body||q.consumed_at!==null||q.event_millis===0||q.binding_id!==a.bindingId||q.binding_revision!==a.bindingRevision||q.epoch!==a.epoch||(q.connection_epoch??0)!==connectionEpoch(a)||q.application_id!==a.applicationId||q.chat_id!==providerChat(a)||await hashSource(q.raw_body)!==q.body_hash)throw sourceReconciliation();
 const e=event.parse(JSON.parse(q.raw_body)),m=e.payload;
 if(e.id!==q.event_id||e.type!==q.event_type||Date.parse(e.created_at)!==q.event_millis||e.application_id!==a.applicationId||e.application_production!==Boolean(a.production)||e.account_id!==a.accountId||e.account_scope_id!==a.scopeId||m.chat_id!==providerChat(a)||m.id!==q.message_id)throw sourceReconciliation();
 if(m.text===undefined&&!m.attachments.length&&!m.is_hidden&&!m.is_deleted)throw sourceReconciliation();
 return canonicalMessage(m,{sequence:q.sequence,bodyHash:q.body_hash,eventMillis:q.event_millis},a.chatId);
}
export async function canonicalMessage(m:HostedMessage,v:{sequence:number;bodyHash:string;eventMillis:number;origin?:'webhook'|'history'},appChatId=m.chat_id){
 const original=m.text??'',date=new Date(m.timestamp).toISOString(),attachments=m.attachments.map(x=>[x.id,x.type,x.mimetype,x.is_inline,x.file_size??null,x.is_unavailable??null]).sort((x,y)=>JSON.stringify(x)<JSON.stringify(y)?-1:JSON.stringify(x)>JSON.stringify(y)?1:0),fingerprint=await hashSource(JSON.stringify([original,date,m.is_hidden,m.is_deleted,m.is_edited,attachments]));
 return {version:{...v,fingerprint,chatId:m.chat_id,messageId:m.id} as SourceVersion,id:m.id,chatId:appChatId,date,original,hidden:m.is_hidden,deleted:m.is_deleted,unreadMedia:m.attachments.length>0};
}
export type CanonicalMessage=Awaited<ReturnType<typeof canonicalEvent>>;
export const readBatchRow=(c:SourceContext['c'],user:string,batch:string)=>c.DB.prepare(`SELECT *,${clock} AS now FROM kids_hosted_batches WHERE owner_user_id=? AND id=?`).bind(user,batch).first<BatchRow>();
export function batchFence(a:BatchAuthority){
 if(a.versions.some(v=>v.origin==='history'))return historyBatchFence(a);
 return {sql:`EXISTS(SELECT 1 FROM kids_hosted_batches r WHERE r.id=? AND r.source_kind='webhook' AND r.owner_user_id=kids_state.user_id AND r.workspace_id=kids_state.id AND r.status='ready' AND r.expires_at>${clock} AND r.config_hash=? AND r.binding_id=? AND r.binding_revision=? AND r.epoch=? AND r.service_grant_id=? AND r.service_revision=? AND r.chat_id=? AND COALESCE(r.app_chat_id,r.chat_id)=? AND r.connection_epoch=? AND r.child_id=? AND r.topic=? AND (r.submitted_hash IS NULL OR r.submitted_hash=?) AND (SELECT COUNT(*) FROM kids_hosted_batch_members m WHERE m.batch_id=r.id)=json_array_length(?) AND NOT EXISTS(SELECT 1 FROM json_each(?) v LEFT JOIN kids_hosted_batch_members m ON m.batch_id=r.id AND m.event_sequence=json_extract(v.value,'$.sequence') LEFT JOIN kids_hosted_events e ON e.sequence=m.event_sequence WHERE m.event_sequence IS NULL OR m.body_hash<>json_extract(v.value,'$.bodyHash') OR m.fingerprint<>json_extract(v.value,'$.fingerprint') OR e.body_hash<>m.body_hash OR e.raw_body IS NULL OR e.consumed_at IS NOT NULL OR e.connection_epoch<>r.connection_epoch OR e.event_millis<>m.event_millis OR EXISTS(SELECT 1 FROM kids_hosted_events n WHERE n.binding_id=e.binding_id AND n.chat_id=e.chat_id AND n.message_id=e.message_id AND (n.event_millis>e.event_millis OR n.event_millis=e.event_millis AND n.sequence>e.sequence)) OR EXISTS(SELECT 1 FROM kids_hosted_message_heads h WHERE h.binding_id=e.binding_id AND h.chat_id=e.chat_id AND h.message_id=e.message_id AND (h.event_millis>e.event_millis OR h.event_millis=e.event_millis AND h.event_sequence>=e.sequence))))`,values:[a.batchId,a.configHash,a.bindingId,a.bindingRevision,a.epoch,a.service.grantId,a.service.revision,providerChat(a),a.chatId,connectionEpoch(a),a.childId,a.topic,a.interpretationHash,JSON.stringify(a.versions),JSON.stringify(a.versions)]};
}
export function viewHints(k:Kids,childId:string,managed:ReadonlySet<string>){
 const hints:unknown[]=[];let bytes=2,partial=false;const contexts=k.contexts.filter(c=>!childId||!c.childIds.length||c.childIds.includes(childId)).sort((x,y)=>y.updatedAt.localeCompare(x.updatedAt)||x.id.localeCompare(y.id));
 for(const c of contexts){const hint={id:c.id,key:c.key,kind:c.kind,...(c.workflow?{workflow:c.workflow}:{}),title:c.title,childIds:c.childIds,tasks:c.tasks.map(t=>({id:t.id,key:t.key,childId:t.childId,title:t.title,resolution:t.resolution,sourceManaged:managed.has(c.id+':'+t.id)}))},n=new TextEncoder().encode(JSON.stringify(hint)).length+1;if(hints.length>=20||bytes+n>100*1024){partial=true;continue;}hints.push(hint);bytes+=n;}
 return {viewHints:hints,viewHintsPartial:partial};
}

export type HistoryRow={sequence:number;page_id:string;binding_id:string;binding_revision:number;epoch:number;chat_id:string;message_id:string;body_hash:string;fingerprint:string;message_millis:number;raw_body:string|null;raw_bytes:number;consumed_at:number|null;response_hash:string;page_status:string;authority_json:string;prior_head_sequence:number|null;prior_head_hash:string|null};
export const knownWebhookSql=(binding:string,chat:string,message:string)=>`(EXISTS(SELECT 1 FROM kids_hosted_events w WHERE w.binding_id=${binding} AND w.chat_id=${chat} AND w.message_id=${message}) OR EXISTS(SELECT 1 FROM kids_hosted_message_heads w WHERE w.binding_id=${binding} AND w.chat_id=${chat} AND w.message_id=${message}))`;
export async function canonicalHistory(q:HistoryRow,a:SourceAuthority){
 if(!q.raw_body||q.consumed_at!==null||q.binding_id!==a.bindingId||q.binding_revision!==a.bindingRevision||q.epoch!==a.epoch||q.chat_id!==providerChat(a)||q.page_status!=='committed'||!q.response_hash||q.authority_json!==JSON.stringify(a)||await hashSource(q.raw_body)!==q.body_hash)throw sourceReconciliation();
 const m=hostedMessageSchema.parse(JSON.parse(q.raw_body));if(m.id!==q.message_id||m.chat_id!==providerChat(a)||Date.parse(m.timestamp)!==q.message_millis)throw sourceReconciliation();const out=await canonicalMessage(m,{sequence:q.sequence,bodyHash:q.body_hash,eventMillis:q.message_millis,origin:'history'},a.chatId);if(out.version.fingerprint!==q.fingerprint)throw sourceReconciliation();out.version.priorHistorySequence=q.prior_head_sequence;out.version.priorHistoryHash=q.prior_head_hash;return out;
}
// Keep the atomic guard below D1's expression-depth limit without splitting
// validation from the statement it protects. Balanced trees retain every fence.
function balancedSql(parts:string[],operator:'AND'|'OR'):string{
 if(parts.length===1)return parts[0];const middle=Math.floor(parts.length/2);
 return `(${balancedSql(parts.slice(0,middle),operator)} ${operator} ${balancedSql(parts.slice(middle),operator)})`;
}
function historyBatchFence(a:BatchAuthority){
 const invalid=balancedSql([
  'm.message_sequence IS NULL','e.sequence IS NULL','p.id IS NULL','s.id IS NULL',
  "json_extract(v.value,'$.origin') IS NOT 'history'",
  "m.body_hash<>json_extract(v.value,'$.bodyHash')","m.fingerprint<>json_extract(v.value,'$.fingerprint')",
  "m.prior_head_sequence IS NOT json_extract(v.value,'$.priorHistorySequence')","m.prior_head_hash IS NOT json_extract(v.value,'$.priorHistoryHash')",
  'e.body_hash<>m.body_hash','e.fingerprint<>m.fingerprint','e.chat_id<>m.chat_id','e.message_id<>m.message_id',
  'e.binding_id<>r.binding_id','e.binding_revision<>r.binding_revision','e.epoch<>r.epoch',
  'e.raw_body IS NULL','e.consumed_at IS NOT NULL',"p.status<>'committed'",'p.response_hash IS NULL',
  'p.owner_user_id<>r.owner_user_id','p.workspace_id<>r.workspace_id','s.authority_hash IS NOT ?',
  knownWebhookSql('e.binding_id','e.chat_id','e.message_id'),
  'EXISTS(SELECT 1 FROM kids_hosted_history_messages n WHERE n.binding_id=e.binding_id AND n.chat_id=e.chat_id AND n.message_id=e.message_id AND n.sequence>e.sequence)',
  "NOT ((json_extract(v.value,'$.priorHistorySequence') IS NULL AND NOT EXISTS(SELECT 1 FROM kids_hosted_history_heads h WHERE h.binding_id=e.binding_id AND h.chat_id=e.chat_id AND h.message_id=e.message_id)) OR EXISTS(SELECT 1 FROM kids_hosted_history_heads h WHERE h.binding_id=e.binding_id AND h.chat_id=e.chat_id AND h.message_id=e.message_id AND h.message_sequence=json_extract(v.value,'$.priorHistorySequence') AND h.body_hash=json_extract(v.value,'$.priorHistoryHash')))"
 ],'OR');
 const valid=balancedSql([
  'r.id=?',"r.source_kind='history'",'r.owner_user_id=kids_state.user_id','r.workspace_id=kids_state.id',"r.status='ready'",`r.expires_at>${clock}`,
  'r.config_hash=?','r.binding_id=?','r.binding_revision=?','r.epoch=?','r.service_grant_id=?','r.service_revision=?','r.chat_id=?','COALESCE(r.app_chat_id,r.chat_id)=?','r.connection_epoch=?','r.child_id=?','r.topic=?',
  '(r.submitted_hash IS NULL OR r.submitted_hash=?)',
  '(SELECT COUNT(*) FROM kids_hosted_history_batch_members m WHERE m.batch_id=r.id)=json_array_length(?)',
  `NOT EXISTS(SELECT 1 FROM json_each(?) v LEFT JOIN kids_hosted_history_batch_members m ON m.batch_id=r.id AND m.message_sequence=json_extract(v.value,'$.sequence') LEFT JOIN kids_hosted_history_messages e ON e.sequence=m.message_sequence LEFT JOIN kids_hosted_history_pages p ON p.id=e.page_id LEFT JOIN kids_hosted_history_scans s ON s.id=p.scan_id WHERE ${invalid})`
 ],'AND');
 return {sql:`EXISTS(SELECT 1 FROM kids_hosted_batches r WHERE ${valid})`,values:[a.batchId,a.configHash,a.bindingId,a.bindingRevision,a.epoch,a.service.grantId,a.service.revision,providerChat(a),a.chatId,connectionEpoch(a),a.childId,a.topic,a.interpretationHash,JSON.stringify(a.versions),JSON.stringify(a.versions),a.historyAuthorityHash??'']};
}
