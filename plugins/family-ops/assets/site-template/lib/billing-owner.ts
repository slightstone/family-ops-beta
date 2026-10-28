import {env} from 'cloudflare:workers';
import {FamilyError} from './family';
import {resolveFamily,sharingEnabled,type FamilyRow} from './family-sharing';
export type BillingOwnerScope={kidsWorkspaceId:string};
export async function resolveBillingOwner(userId:string,scope?:BillingOwnerScope,bind?:{workspaceId:string;grantId:string}){
 if(!env.DB)throw new FamilyError('Subscription storage is unavailable.',503);
 if(scope){
  if(sharingEnabled()&&await env.DB.prepare('SELECT 1 FROM workspace_memberships WHERE member_user_id=?').bind(userId).first())throw new FamilyError('Kids payments need an unambiguous owner account. Leave the shared planner before managing this account’s subscription. Your Kids board and export remain available.',403);
  const row=await env.DB.prepare('SELECT w.* FROM kids_commerce c JOIN workspace_state w ON w.user_id=c.owner_user_id AND w.id=c.account_id JOIN kids_state k ON k.user_id=c.owner_user_id AND k.id=c.workspace_id WHERE c.owner_user_id=? AND c.workspace_id=?').bind(userId,scope.kidsWorkspaceId).first<FamilyRow>();
  if(!row)throw new FamilyError('Open the current Kids subscription setup first.',403);
  if(bind&&(bind.workspaceId!==row.id||bind.grantId!==row.id))throw new FamilyError('Kids payment access changed. Reopen the saved subscription.',403);
  return {...row,surface:'kids' as const};
 }
 const a=await resolveFamily(userId);if(!a)throw new FamilyError('Create a workspace first.',404);
 if(a.access.role!=='owner')throw new FamilyError('Only the household owner can manage payments.',403);
 if(bind&&(bind.workspaceId!==a.row.id||bind.grantId!==a.row.id))throw new FamilyError('Access changed. Open the current owner workspace.',403);
 return {...a.row,surface:'planner' as const};
}
