import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {FamilyError} from './family';
import {digest,sharingEnabled} from './family-sharing';
import {resolveBillingOwner} from './billing-owner';
import {checkoutConfiguration,getFamilyCheckout,changeFamilyCheckout} from './family-checkout';
import {refreshFamilyBilling} from './family-billing';
import {kidsServiceStatus} from './kids-service';
import {bindPaidKidsService} from './kids-commerce-binding';
import {billingNowSql as clock} from './stripe-provider';
const db=()=>{if(!env.DB)throw new FamilyError('Kids subscription storage is unavailable.',503);return env.DB;};
const workspace=z.string().uuid();
function enabled(){return !!checkoutConfiguration()&&(env as typeof env&{FAMILY_OPS_KIDS_LIVE?:string}).FAMILY_OPS_KIDS_LIVE==='enabled';}
async function current(user:string,id:string){
 workspace.parse(id);
 if(sharingEnabled()&&await db().prepare('SELECT 1 FROM workspace_memberships WHERE member_user_id=?').bind(user).first())throw new FamilyError('Kids payments need an unambiguous owner account. Leave the shared planner before managing this account’s subscription. Your Kids board and export remain available.',403);
 const row=await db().prepare(`SELECT id,revision,${clock} AS now FROM kids_state WHERE user_id=? AND id=?`).bind(user,id).first<{id:string;revision:number;now:number}>();
 if(!row)throw new FamilyError('Open your current Kids workspace before managing its subscription.',403);return row;
}
const mapping=(user:string,id:string)=>db().prepare('SELECT * FROM kids_commerce WHERE owner_user_id=? AND workspace_id=?').bind(user,id).first<{account_id:string;prepare_operation_id:string;prepare_body_hash:string}>();
export async function getKidsCheckout(user:string,id:string,intent?:string|null){
 if(!enabled())return {enabled:false};await current(user,id);const link=await mapping(user,id);
 if(!link)return {enabled:true,prepared:false,service:await kidsServiceStatus(user,id)};
 return {...await getFamilyCheckout(user,intent,{kidsWorkspaceId:id}),prepared:true,accountId:link.account_id,service:await kidsServiceStatus(user,id)};
}
const prepare=z.object({action:z.literal('prepare'),workspaceId:workspace,baseRevision:z.number().int().min(1),operationId:z.string().uuid(),createdAt:z.number().int().nonnegative(),confirmed:z.literal(true)}).strict();
async function prepareAccount(user:string,input:unknown){
 const a=prepare.parse(input),k=await current(user,a.workspaceId),hash=await digest(JSON.stringify(a));let link=await mapping(user,k.id);
 if(link?.prepare_operation_id===a.operationId){if(link.prepare_body_hash!==hash)throw new FamilyError('This retry belongs to a different Kids subscription setup.',409);}
 else{
  if(k.revision!==a.baseRevision)throw new FamilyError('Kids changed. Reopen the current subscription offer.',409);
  if(a.createdAt<k.now-600000||a.createdAt>k.now+30000)throw new FamilyError('This Kids subscription setup expired. Check the offer again.',409);
  if(!link){
   const account=crypto.randomUUID(),sentinel=JSON.stringify({schemaVersion:1,accountOnly:true,id:account});
   const member=sharingEnabled()?' AND NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?)':'';
   await db().batch([
    db().prepare(`INSERT INTO workspace_state(purpose,user_id,id,revision,document,policy,operations,updated_at) SELECT 'account',?,?,1,?,'{}','{}',? FROM kids_state k WHERE k.user_id=? AND k.id=? AND k.revision=? AND NOT EXISTS(SELECT 1 FROM workspace_state WHERE user_id=?)${member}`).bind(user,account,sentinel,new Date().toISOString(),user,k.id,k.revision,user,...(sharingEnabled()?[user]:[])),
    db().prepare(`INSERT INTO kids_commerce(owner_user_id,workspace_id,account_id,prepare_operation_id,prepare_body_hash,created_at) SELECT k.user_id,k.id,w.id,?,?,${clock} FROM kids_state k JOIN workspace_state w ON w.user_id=k.user_id WHERE k.user_id=? AND k.id=? AND k.revision=?${member} ON CONFLICT(owner_user_id,workspace_id) DO NOTHING`).bind(a.operationId,hash,user,k.id,k.revision,...(sharingEnabled()?[user]:[])),
   ]);
   link=await mapping(user,k.id);if(!link)throw new FamilyError('Kids access changed. No checkout was started.',409);
  }
 }
 const target=await resolveBillingOwner(user,{kidsWorkspaceId:k.id});
 const quote=await changeFamilyCheckout(user,{action:'quote',workspaceId:target.id,grantId:target.id},{kidsWorkspaceId:k.id});
 await resolveBillingOwner(user,{kidsWorkspaceId:k.id});await bindPaidKidsService(user,target.id);
 return {...await getKidsCheckout(user,k.id),...quote};
}
export async function changeKidsCheckout(user:string,input:unknown){
 if(!enabled())throw new FamilyError('Kids subscriptions are not available yet.',404);
 if(typeof input==='object'&&input!==null&&'action' in input&&input.action==='prepare')return prepareAccount(user,input);
 const {kidsWorkspaceId,...body}=z.object({kidsWorkspaceId:workspace}).passthrough().parse(input);
 await current(user,kidsWorkspaceId);
 return changeFamilyCheckout(user,body,{kidsWorkspaceId});
}
export async function refreshKidsBilling(user:string,input:unknown){
 if(!enabled())throw new FamilyError('Kids subscriptions are not available yet.',404);
 const {kidsWorkspaceId,...body}=z.object({kidsWorkspaceId:workspace}).passthrough().parse(input);await current(user,kidsWorkspaceId);
 const result=await refreshFamilyBilling(user,body,{kidsWorkspaceId});await resolveBillingOwner(user,{kidsWorkspaceId});return result;
}
