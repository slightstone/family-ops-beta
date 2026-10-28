import {env} from 'cloudflare:workers';
import {KidsError} from './kids';
import {billingNowSql as clock,stripeConfiguration} from './stripe-provider';
import {verifyBilling} from './family-billing';
import {ownedInstallation} from './owned-installation';

export type ServiceStamp={grantId:string;revision:number};
type Access={owner_user_id:string;workspace_id:string;grant_id:string;revision:number;kind:'beta'|'subscription'|'owned';beta_until:number|null;billing_workspace_id:string|null;revoked_at:number|null;created_at:number;now:number;authorized:number};
export type KidsServiceStatus={active:boolean;state:'no_grant'|'active'|'expired'|'revoked'|'unavailable';kind:'beta'|'subscription'|'owned'|null;expiresAt:number|null;message:string};
const database=()=>{if(!env.DB)throw new KidsError('Kids service verification is unavailable. Saved work is unchanged.',503);return env.DB;};

// One predicate serves projection, initial authorization and the final atomic D1 write.
// No client clock, purchase return URL or model argument can grant service.
function predicate(){
 const owned=ownedInstallation();
 if(owned.kind==='invalid-owned')return {sql:'0',values:[] as (string|null)[]};
 if(owned.kind==='owned')return {sql:`a.kind='owned' AND a.owner_user_id=? AND a.grant_id=? AND a.beta_until IS NULL AND a.billing_workspace_id IS NULL AND a.revoked_at IS NULL AND a.created_at<=${clock}`,values:[owned.ownerId,owned.installationId]};
 const c=stripeConfiguration();
 return {sql:`a.revoked_at IS NULL AND a.created_at<=${clock} AND ((a.kind='beta' AND a.beta_until>${clock}) OR (a.kind='subscription' AND EXISTS(SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=a.owner_user_id AND b.workspace_id=a.billing_workspace_id AND b.mode=? AND b.price_id=? AND b.status='active' AND b.paid_through>${clock} AND b.verified_at<=${clock} AND b.verified_at>${clock}-300000 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL)))`,values:[c?.mode??null,c?.price??null]};
}
async function access(user:string,workspace:string){const p=predicate();return database().prepare(`SELECT a.*,${clock} AS now,CASE WHEN ${p.sql} THEN 1 ELSE 0 END AS authorized FROM kids_service_access a WHERE a.owner_user_id=? AND a.workspace_id=?`).bind(...p.values,user,workspace).first<Access>();}
function status(a:Access|null):KidsServiceStatus{
 const owned=ownedInstallation();
 if(owned.kind!=='shared'){
  const base={kind:'owned' as const,expiresAt:null};
  if(owned.kind==='invalid-owned')return {...base,active:false,state:'unavailable',message:'Your private installation setup is incomplete. Saved work and export remain available.'};
  if(!a)return {...base,active:false,state:'no_grant',message:'Finish your private installation setup to connect WhatsApp. Saved work remains available.'};
  if(a.kind!=='owned'||a.owner_user_id!==owned.ownerId||a.grant_id!==owned.installationId)return {...base,active:false,state:'unavailable',message:'Your private installation configuration changed. Reopen setup; saved work remains available.'};
  if(a.revoked_at!==null)return {...base,active:false,state:'revoked',message:'Your private installation is paused. Saved work, manual changes and export remain available.'};
  return {...base,active:!!a.authorized,state:a.authorized?'active':'unavailable',message:a.authorized?'Your private installation is ready. Your own AI and source-provider account supply processing and connection access.':'Your private installation could not be verified. Saved work remains available.'};
 }
 if(!a)return {active:false,state:'no_grant',kind:null,expiresAt:null,message:'No active Kids service grant. Managed syncing is paused.'};
 if(a.revoked_at!==null)return {active:false,state:'revoked',kind:a.kind,expiresAt:a.beta_until,message:'Kids service access was revoked. Managed syncing is paused.'};
 if(a.authorized)return {active:true,state:'active',kind:a.kind,expiresAt:a.beta_until,message:a.kind==='beta'?'An active beta grant covers managed Kids syncing.':'A verified subscription covers managed Kids syncing.'};
 if(a.kind==='beta'&&a.beta_until!==null&&a.beta_until<=a.now)return {active:false,state:'expired',kind:a.kind,expiresAt:a.beta_until,message:'Your Kids beta grant expired. Managed syncing is paused.'};
 return {active:false,state:'unavailable',kind:a.kind,expiresAt:a.beta_until,message:'Kids service could not be verified. Managed syncing is paused.'};
}
// Pure SELECT: safe for read-only MCP tools. Never refreshes provider or cleans metadata.
export async function kidsServiceStatus(user:string,workspace:string|null){return status(workspace?await access(user,workspace):null);}
export async function requireKidsService(user:string,workspace:string,refreshBilling=true):Promise<ServiceStamp>{
 let a=await access(user,workspace);
 if(ownedInstallation().kind==='shared'&&refreshBilling&&a?.kind==='subscription'&&a.revoked_at===null&&a.created_at<=a.now&&!a.authorized){
  const c=stripeConfiguration();if(c&&a.billing_workspace_id){try{await verifyBilling(user,a.billing_workspace_id,c);}catch{throw new KidsError('Kids subscription verification is unavailable. Managed syncing is paused; saved work remains available.',503);}a=await access(user,workspace);}
 }
 const s=status(a);if(!s.active||!a)throw new KidsError(s.message+' Your saved board, manual changes and export remain available.',403);
 return {grantId:a.grant_id,revision:a.revision};
}
export function kidsServiceGuard(stamp:ServiceStamp){const p=predicate();return {sql:`EXISTS(SELECT 1 FROM kids_service_access a WHERE a.owner_user_id=kids_state.user_id AND a.workspace_id=kids_state.id AND a.grant_id=? AND a.revision=? AND ${p.sql})`,values:[stamp.grantId,stamp.revision,...p.values]};}
