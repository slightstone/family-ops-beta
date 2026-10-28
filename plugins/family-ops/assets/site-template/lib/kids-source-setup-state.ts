import {env} from 'cloudflare:workers';
import {z} from 'zod/v4';
import {checkedKids,kidsNeedsUpgrade,KidsError} from './kids';
import {projectKidsHostedAuth} from './kids-hosted-auth';
import {projectSavedRemoval,type Removal} from './kids-hosted-removal-state';
import {controlReceiptSchema} from './kids-source-control-state';
import type {KidsSourceConnection} from './kids-source-connections';
import {billingNowSql as clock} from './stripe-provider';

// Every returned status comes from one D1 read transaction. Neither a provider
// credential nor a provider call is required, including OFF/expired service.
export async function readKidsSourceSetup(user:string,workspace:string){
 z.string().uuid().parse(workspace);const db=env.DB;if(!db)throw new KidsError('Saved WhatsApp settings are unavailable.',503);
 const authFields='operation_id,workspace_id,workspace_revision,intent,slot_id,slot_revision,slot_epoch,binding_id,verified_binding_id,recovery_of,status,lease_until,expires_at,recovery_result,candidate_account_id,endpoint_id,scope_id,sync_status';
 const safe="CASE WHEN json_valid(source_authority) THEN source_authority ELSE '{}' END";
 const result=await db.batch([
  db.prepare('SELECT id,revision,epoch,document,operations FROM kids_state WHERE user_id=? AND id=?').bind(user,workspace),
  db.prepare('SELECT * FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? ORDER BY slot_number,created_at,id').bind(user,workspace),
  db.prepare(`SELECT ${authFields},${clock} AS now FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY COALESCE(slot_id,verified_binding_id,binding_id,workspace_id) ORDER BY created_at DESC,rowid DESC) AS rank FROM kids_hosted_auth WHERE owner_user_id=? AND workspace_id=?) WHERE rank=1 ORDER BY slot_id,operation_id`).bind(user,workspace),
  db.prepare(`SELECT *,${clock} AS now,(SELECT COUNT(*) FROM kids_hosted_removal_targets t WHERE t.owner_user_id=r.owner_user_id AND t.operation_id=r.operation_id AND t.absent_at IS NOT NULL) AS removed_count FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY COALESCE(target_connection_id,workspace_id) ORDER BY (status<>'completed') DESC,created_at DESC,rowid DESC) AS rank FROM kids_hosted_removals WHERE owner_user_id=? AND workspace_id=?) r WHERE rank=1 ORDER BY target_connection_id,operation_id`).bind(user,workspace),
  db.prepare(`SELECT operation_id,source_authority FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY json_extract(${safe},'$.result.connectionId') ORDER BY committed_revision DESC,rowid DESC) AS rank FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND json_extract(${safe},'$.kind')='kids-connection-control-v1') WHERE rank=1 ORDER BY operation_id`).bind(user,workspace),
  db.prepare('SELECT proposal_id,proposal_hash,effect_operation_id,status,created_at,expires_at,approved_at,cancelled_at,preview_json FROM kids_source_proposals WHERE owner_user_id=? AND workspace_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20').bind(user,workspace),
 ]);
 const row=result[0].results[0] as {id:string;revision:number;epoch:number;document:string;operations:string}|undefined;if(!row)throw new KidsError('Open your current Kids workspace.',404);
 const kids=checkedKids(JSON.parse(row.document));if(kidsNeedsUpgrade(kids,row.operations))throw new KidsError('Finish the saved Kids storage upgrade first.',503);
 const removals=result[3].results as unknown as (Removal&{removed_count:number})[],whole=removals.find(r=>r.target_connection_id===null&&r.status!=='completed');
 const auth=result[2].results as unknown as (Parameters<typeof projectKidsHostedAuth>[0]&{binding_id:string|null;verified_binding_id:string|null})[];
 const controls=(result[4].results as {operation_id:string;source_authority:string}[]).map(r=>({operationId:r.operation_id,receipt:controlReceiptSchema.parse(JSON.parse(r.source_authority))}));
 const connections=(result[1].results as unknown as KidsSourceConnection[]).map(c=>{
  const latest=controls.find(r=>r.receipt.result.connectionId===c.id),removal=whole??removals.find(r=>r.target_connection_id===c.id),attempt=auth.find(a=>a.slot_id===c.id||a.binding_id===c.id||a.verified_binding_id===c.id);
  return {id:c.id,bindingId:c.binding_id,label:c.label,slot:c.slot_number,status:c.status,revision:c.revision,sourceEpoch:c.source_epoch,discoveryConsent:!!c.discovery_consent,processingConsent:!!c.processing_consent,confirmedAt:c.confirmed_at,paused:!!c.paused,resumeFrom:c.paused&&latest?.receipt.result.action==='pause'?latest.operationId:null,
   auth:attempt?projectKidsHostedAuth(attempt):null,removal:removal?projectSavedRemoval(removal,removal.removed_count):null,removalPending:!!removal&&removal.status!=='completed'};
 });
 return {workspaceId:row.id,boardRevision:row.revision,needsPreparation:!connections.length&&kids.mode==='live'&&!!kids.connection.accountId,connections,wholeRemoval:whole?projectSavedRemoval(whole,whole.removed_count):null,
  unassignedAuth:auth.filter(a=>!connections.some(c=>[a.slot_id,a.binding_id,a.verified_binding_id].includes(c.id))).map(projectKidsHostedAuth),
  proposals:(result[5].results as Record<string,unknown>[]).map(r=>({id:String(r.proposal_id),hash:String(r.proposal_hash),effectOperationId:String(r.effect_operation_id),status:String(r.status),createdAt:Number(r.created_at),expiresAt:Number(r.expires_at),approvedAt:r.approved_at===null?null:Number(r.approved_at),cancelledAt:r.cancelled_at===null?null:Number(r.cancelled_at),preview:JSON.parse(String(r.preview_json))})),coverage:'Saved settings only. No provider account, chat titles or messages were read.'};
}
export type KidsSourceSetup=Awaited<ReturnType<typeof readKidsSourceSetup>>;
