import {z} from 'zod/v4';
import {KidsError,withoutPauseGaps,type Kids} from './kids';
import {catalogBinding,catalogConnectionFence,catalogCanDiscover,catalogDb} from './kids-chat-catalog-state';
import {readKidsChatSource} from './kids-source-connections';
import {kidsHostedSettings} from './kids-hosted-api';
import {KIDS_HOSTED_CONSENT} from './kids-hosted-config';
import {connectionRemovalGuard} from './kids-hosted-removal-state';
const id=z.string().min(1).max(180),proof=z.object({bindingId:z.string().uuid(),revision:z.number().int().min(1),sourceEpoch:z.number().int().min(0)}).strict();
const confirm=z.object({consent:z.literal(true),targets:z.array(proof.extend({chatIds:z.array(id).min(1).max(30)}).strict()).min(1).max(2).optional()}).strict();
const toggle=z.object({chatId:id,enabled:z.boolean(),childId:z.string().max(180).optional(),topic:z.enum(['kids','school','activities','celebrations','preparation']).optional(),connection:proof.optional()}).strict();
type Update={id:string;revision:number;sourceEpoch:number;processingConsent:number;confirmedAt:string|null;chatIds:string[]};
export type SourcePermissionChange={fence:{sql:string;values:(string|number|null)[]};updates:Update[];receipt:{kind:'kids-source-permission-v1';result:{action:string;targets:{bindingId:string;revision:number;sourceEpoch:number;processingConsent:boolean;chatIds:string[]}[]}}};
const conflict=()=>new KidsError('This WhatsApp review changed. Reopen its exact account and chat choices before confirming.',409);

// Prepared source permission has one authority path. It never changes the
// workspace epoch: another connection's already approved batch remains valid.
export async function prepareSourcePermission(user:string,original:Kids,type:'confirm'|'source',args:unknown){
 const k=structuredClone(original),db=catalogDb(),now=new Date().toISOString();
 if(k.mode!=='live')throw conflict();
 const groups=new Map<string,Kids['candidates']>();let enabling=true;
 const c=type==='confirm'?confirm.safeParse(args):toggle.safeParse(args);
 if(!c.success)throw new KidsError('Check the exact connection and reviewed chat choices.');
 if(type==='confirm'){
  const a=c.data as z.infer<typeof confirm>,pending=k.candidates.filter(x=>x.decision==='selected'&&(!k.confirmedAt||x.reviewPending));
  for(const candidate of pending){const m=await readKidsChatSource(db,user,k.id,candidate.id);if(!m||candidate.accountId!=='hosted:'+m.binding_id)throw conflict();const group=groups.get(m.binding_id)??[];group.push(candidate);groups.set(m.binding_id,group);}
  if(!groups.size)throw new KidsError('Select a new chat or an explicit tracking change to review.');
  if(a.targets){
   if(new Set(a.targets.map(t=>t.bindingId)).size!==a.targets.length)throw conflict();
   const chosen=new Map<string,Kids['candidates']>();
   for(const target of a.targets){const group=groups.get(target.bindingId);if(!group||new Set(target.chatIds).size!==target.chatIds.length||JSON.stringify([...target.chatIds].sort())!==JSON.stringify(group.map(v=>v.id).sort()))throw conflict();chosen.set(target.bindingId,group);}
   groups.clear();for(const [key,value]of chosen)groups.set(key,value);
  }else if(groups.size!==1)throw new KidsError('Choose which WhatsApp account’s pending chats to confirm. Earlier tracking is unchanged.',409);
 }else{
  const a=c.data as z.infer<typeof toggle>,candidate=k.candidates.find(x=>x.id===a.chatId),grant=k.grants.find(x=>x.chatId===a.chatId),mapping=await readKidsChatSource(db,user,k.id,a.chatId);enabling=a.enabled;
  if(!candidate||!grant||!mapping||candidate.accountId!=='hosted:'+mapping.binding_id||a.childId!==undefined&&a.childId!==grant.childId||a.topic!==undefined&&a.topic!==grant.topic)throw new KidsError('Review and confirm this chat’s people and purpose before tracking.',403);
  if(a.enabled&&(!k.processingConsent||!k.confirmedAt))throw new KidsError('Confirm processing before tracking.',403);
  if(a.connection&&a.connection.bindingId!==mapping.binding_id)throw conflict();
  groups.set(mapping.binding_id,[candidate]);
 }
 const config=enabling?await kidsHostedSettings():null,updates:Update[]=[],fences:{sql:string;values:(string|number|null)[]}[]=[];
 for(const [bindingId,items]of groups){
  const b=await catalogBinding(user,k.id,k,bindingId),connection=b.connection;
  if(!connection||connection.status!=='connected')throw conflict();
  const a=c.data,expected=type==='confirm'?(a as z.infer<typeof confirm>).targets?.find(t=>t.bindingId===bindingId):(a as z.infer<typeof toggle>).connection;
  if(expected&&(expected.revision!==connection.revision||expected.sourceEpoch!==connection.source_epoch))throw conflict();
  if(enabling){catalogCanDiscover(b);if(!k.discoveryConsent||!b.active||b.removed_at!==null||b.application_id!==config!.UNIPILE_APPLICATION_ID||b.production!==Number(config!.UNIPILE_ENVIRONMENT==='production')||b.endpoint_id!==config!.channelId||b.consent_version!==KIDS_HOSTED_CONSENT||!/^[a-f0-9]{64}$/.test(b.provider_identity_hash))throw conflict();if(type==='source'&&(!connection.processing_consent||!connection.confirmed_at))throw new KidsError('Review and confirm this WhatsApp account before enabling its chat.',403);}
  const removal=connectionRemovalGuard(bindingId),local=enabling?catalogConnectionFence(bindingId,connection):{sql:"EXISTS(SELECT 1 FROM kids_source_connections cc WHERE cc.owner_user_id=kids_state.user_id AND cc.workspace_id=kids_state.id AND cc.id=? AND cc.binding_id=? AND cc.status='connected' AND cc.revision=? AND cc.source_epoch=?)",values:[bindingId,bindingId,connection.revision,connection.source_epoch]};
  const bindingSql='EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.owner_user_id=kids_state.user_id AND b.workspace_id=kids_state.id AND b.id=? AND b.revision=? AND b.active=? AND b.removed_at IS ? AND b.application_id=? AND b.production=? AND b.endpoint_id=? AND b.scope_id=? AND b.account_id=? AND b.provider_identity_hash=? AND b.consent_version=?)';
  fences.push({sql:removal.sql+' AND '+local.sql+' AND '+bindingSql,values:[...removal.values,...local.values,b.id,b.revision,b.active,b.removed_at,b.application_id,b.production,b.endpoint_id,b.scope_id,b.account_id,b.provider_identity_hash,b.consent_version]});
  updates.push({id:bindingId,revision:connection.revision,sourceEpoch:connection.source_epoch,processingConsent:type==='confirm'?1:connection.processing_consent,confirmedAt:type==='confirm'?now:connection.confirmed_at,chatIds:items.map(x=>x.id)});
  for(const candidate of items){
   if(candidate.childId&&!k.children.some(child=>child.id===candidate.childId))throw conflict();
   if(type==='confirm'){const next={chatId:candidate.id,childId:candidate.childId,topic:candidate.topic,...(candidate.attendanceAuthority?{attendanceAuthority:candidate.attendanceAuthority}:{}),enabled:true},i=k.grants.findIndex(g=>g.chatId===candidate.id);if(i<0)k.grants.push(next);else k.grants[i]=next;candidate.reviewPending=false;}
   else{const a=c.data as z.infer<typeof toggle>;k.grants.find(g=>g.chatId===candidate.id)!.enabled=a.enabled;candidate.decision=a.enabled?'selected':'ignored';}
  }
 }
 if(k.grants.length>30)throw new KidsError('This board supports thirty saved tracking sources. Earlier tracking is kept.',413);
 if(type==='confirm'){k.processingConsent=true;k.confirmedAt??=now;k.step='board';k.connection.gaps=withoutPauseGaps(k.connection.gaps);}
 const result={action:type,targets:updates.map(x=>({bindingId:x.id,revision:x.revision+1,sourceEpoch:x.sourceEpoch+1,processingConsent:!!x.processingConsent,chatIds:x.chatIds}))};
 return {kids:k,enabling,change:{updates,receipt:{kind:'kids-source-permission-v1',result},fence:{sql:fences.map(x=>'('+x.sql+')').join(' AND '),values:fences.flatMap(x=>x.values)}} satisfies SourcePermissionChange};
}
export function sourcePermissionStatements(db:D1Database,user:string,workspace:string,nonce:string,change:SourcePermissionChange){
 return change.updates.map(x=>db.prepare('UPDATE kids_source_connections SET revision=revision+1,source_epoch=source_epoch+1,processing_consent=?,confirmed_at=?,updated_at=? WHERE owner_user_id=? AND workspace_id=? AND id=? AND revision=? AND source_epoch=? AND EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?)').bind(x.processingConsent,x.confirmedAt,Date.now(),user,workspace,x.id,x.revision,x.sourceEpoch,user,workspace,nonce));
}
export async function originalSourcePermission(user:string,workspace:string,operation:string){
 const r=await catalogDb().prepare('SELECT committed_revision,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,workspace,operation).first<{committed_revision:number;source_authority:string|null}>();
 if(!r?.source_authority)throw conflict();try{const p=JSON.parse(r.source_authority);if(p.kind!=='kids-source-permission-v1'||!p.result)throw conflict();return {...p.result,committedRevision:r.committed_revision};}catch{throw conflict();}
}
