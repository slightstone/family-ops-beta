import {z} from 'zod/v4';
import {KidsError,type Kids} from './kids';
import {catalogBinding,catalogDb} from './kids-chat-catalog-state';
import {kidsAppChatId,type KidsChatSource} from './kids-source-connections';
import {latestKidsConnectionControl,controlConflict,type ControlReceipt} from './kids-source-control-state';
import {connectionRemovalGuard} from './kids-hosted-removal-state';
import {kidsHostedSettings} from './kids-hosted-api';
import {KIDS_HOSTED_CONSENT} from './kids-hosted-config';
import {billingNowSql as clock} from './stripe-provider';
const argsSchema=z.object({action:z.enum(['pause','resume']),connection:z.object({id:z.string().uuid(),revision:z.number().int().min(1),sourceEpoch:z.number().int().min(0)}).strict(),confirmed:z.literal(true),resumeFrom:z.string().uuid().optional()}).strict().refine(a=>a.action!=='pause'||a.resumeFrom===undefined);
export type ConnectionControlChange={fence:{sql:string;values:(string|number|null)[]};id:string;revision:number;epoch:number;bindingRevision:number;scopeId:string;receipt:ControlReceipt};

export async function prepareKidsConnectionControl(user:string,original:Kids,baseRevision:number,operation:string,input:unknown){
 const parsed=argsSchema.safeParse(input);if(!parsed.success)throw new KidsError('Confirm the exact WhatsApp account and pause or resume action.');const a=parsed.data,k=structuredClone(original),db=catalogDb();
 if(k.mode!=='live')throw controlConflict();const binding=await catalogBinding(user,k.id,k,a.connection.id),c=binding.connection;
 if(!c||c.id!==a.connection.id||c.status!=='connected'||c.revision!==a.connection.revision||c.source_epoch!==a.connection.sourceEpoch||binding.removed_at!==null||a.action==='pause'&&(c.paused!==0||binding.active!==1)||a.action==='resume'&&(c.paused!==1||binding.active!==0))throw controlConflict();
 const latest=await latestKidsConnectionControl(db,user,k.id,c.id);if(latest&&latest.committedRevision>baseRevision)throw controlConflict();
 let discovery=false,processing=false,confirmedAt=c.confirmed_at,needsReview=false,restore:ControlReceipt['restore']=null;
 if(a.action==='pause')restore={workspaceEpoch:k.epoch,discoveryConsent:!!c.discovery_consent,processingConsent:!!c.processing_consent,confirmedAt:c.confirmed_at};
 else{
  if(!k.discoveryConsent)throw new KidsError('This household’s WhatsApp access is paused. Review that setting before resuming an account.',403);
  if(latest){if(latest.receipt.result.action!=='pause'||latest.operationId!==a.resumeFrom||!latest.receipt.restore)throw controlConflict();}
  else if(a.resumeFrom!==undefined)throw controlConflict();
  const config=await kidsHostedSettings();
  if(binding.application_id!==config.UNIPILE_APPLICATION_ID||binding.production!==Number(config.UNIPILE_ENVIRONMENT==='production')||binding.endpoint_id!==config.channelId||binding.consent_version!==KIDS_HOSTED_CONSENT||!/^[a-f0-9]{64}$/.test(binding.provider_identity_hash))throw controlConflict();
  discovery=true;const previous=latest?.receipt.restore;
  processing=!!(previous?.discoveryConsent&&previous.processingConsent&&previous.confirmedAt&&previous.confirmedAt===c.confirmed_at&&previous.workspaceEpoch===k.epoch&&k.processingConsent&&k.confirmedAt);
  needsReview=!processing;if(needsReview){confirmedAt=null;
   const maps=(await db.prepare('SELECT * FROM kids_chat_sources WHERE owner_user_id=? AND workspace_id=? AND binding_id=?').bind(user,k.id,c.id).all<KidsChatSource>()).results;
   const candidates=k.candidates.filter(x=>x.accountId==='hosted:'+c.id);
   for(const candidate of candidates){const m=maps.find(x=>x.app_chat_id===candidate.id);if(!m||m.binding_id!==c.id||m.identity_kind==='legacy'&&m.app_chat_id!==m.provider_chat_id||m.identity_kind==='namespaced'&&m.app_chat_id!==await kidsAppChatId(c.id,m.provider_chat_id)||!['legacy','namespaced'].includes(m.identity_kind))throw controlConflict();if(candidate.decision==='selected')candidate.reviewPending=true;}
   if(k.candidates.some(x=>maps.some(m=>m.app_chat_id===x.id)&&x.accountId!=='hosted:'+c.id)||k.grants.some(g=>maps.some(m=>m.app_chat_id===g.chatId)&&!candidates.some(x=>x.id===g.chatId)))throw controlConflict();
  }
 }
 const removal=connectionRemovalGuard(c.id),fence={sql:`${removal.sql} AND EXISTS(SELECT 1 FROM kids_source_connections c WHERE c.owner_user_id=kids_state.user_id AND c.workspace_id=kids_state.id AND c.id=? AND c.binding_id=? AND c.status='connected' AND c.revision=? AND c.source_epoch=? AND c.paused=? AND c.discovery_consent=? AND c.processing_consent=? AND c.confirmed_at IS ?) AND EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.owner_user_id=kids_state.user_id AND b.workspace_id=kids_state.id AND b.id=? AND b.revision=? AND b.active=? AND b.removed_at IS NULL AND b.scope_id=? AND b.account_id=? AND b.application_id=? AND b.production=? AND b.endpoint_id=? AND b.provider_identity_hash=? AND b.consent_version=?)`,values:[...removal.values,c.id,c.id,c.revision,c.source_epoch,c.paused,c.discovery_consent,c.processing_consent,c.confirmed_at,binding.id,binding.revision,Number(a.action==='pause'),binding.scope_id,binding.account_id,binding.application_id,binding.production,binding.endpoint_id,binding.provider_identity_hash,binding.consent_version]};
 const result={action:a.action,connectionId:c.id,revision:c.revision+1,sourceEpoch:c.source_epoch+1,paused:a.action==='pause',discoveryConsent:discovery,processingConsent:processing,confirmedAt,needsReview,resumeFrom:a.action==='pause'?operation:null};
 return {kids:k,enabling:a.action==='resume',change:{fence,id:c.id,revision:c.revision,epoch:c.source_epoch,bindingRevision:binding.revision,scopeId:binding.scope_id,receipt:{kind:'kids-connection-control-v1',result,restore}} satisfies ConnectionControlChange};
}

export function kidsConnectionControlStatements(db:D1Database,user:string,workspace:string,nonce:string,operation:string,change:ConnectionControlChange){
 const r=change.receipt.result,active='EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?)',owner=[user,workspace,nonce],covered="(slot_id=? OR binding_id=? OR verified_binding_id=? OR slot_id IS NULL AND scope_id=?)",target=[change.id,change.id,change.id,change.scopeId];
 return [
  db.prepare(`UPDATE kids_source_connections SET revision=revision+1,source_epoch=source_epoch+1,discovery_consent=?,processing_consent=?,confirmed_at=?,paused=?,updated_at=${clock} WHERE owner_user_id=? AND workspace_id=? AND id=? AND revision=? AND source_epoch=? AND ${active}`).bind(Number(r.discoveryConsent),Number(r.processingConsent),r.confirmedAt,Number(r.paused),user,workspace,change.id,change.revision,change.epoch,...owner),
  db.prepare(`UPDATE kids_hosted_bindings SET active=?,revision=revision+1 WHERE owner_user_id=? AND workspace_id=? AND id=? AND revision=? AND removed_at IS NULL AND ${active}`).bind(Number(!r.paused),user,workspace,change.id,change.bindingRevision,...owner),
  db.prepare(`UPDATE kids_hosted_batches SET status='superseded' WHERE owner_user_id=? AND workspace_id=? AND binding_id=? AND status='ready' AND ${active}`).bind(user,workspace,change.id,...owner),
  ...(r.paused?[db.prepare(`UPDATE kids_hosted_auth SET status='expired',auth_link=NULL,lease_token=NULL,lease_until=NULL WHERE owner_user_id=? AND workspace_id=? AND status NOT IN ('connected','expired') AND ${covered} AND ${active}`).bind(user,workspace,...target,...owner)]:[]),
  db.prepare(`SELECT json(CASE WHEN NOT ${active} OR (EXISTS(SELECT 1 FROM kids_source_connections c JOIN kids_hosted_bindings b ON b.id=c.binding_id WHERE c.owner_user_id=? AND c.workspace_id=? AND c.id=? AND c.revision=? AND c.source_epoch=? AND c.paused=? AND c.discovery_consent=? AND c.processing_consent=? AND c.confirmed_at IS ? AND b.revision=? AND b.active=? AND b.removed_at IS NULL) AND EXISTS(SELECT 1 FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?) AND NOT EXISTS(SELECT 1 FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND binding_id=? AND status='ready') ${r.paused?`AND NOT EXISTS(SELECT 1 FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=? AND status NOT IN ('connected','expired') AND ${covered})`:''}) THEN 'true' ELSE 'KIDS_CONTROL_ATOMIC_OUTCOME_REQUIRED' END)`).bind(...owner,user,workspace,change.id,r.revision,r.sourceEpoch,Number(r.paused),Number(r.discoveryConsent),Number(r.processingConsent),r.confirmedAt,change.bindingRevision+1,Number(!r.paused),user,workspace,operation,user,workspace,change.id,...(r.paused?[user,workspace,...target]:[])),
 ];
}
