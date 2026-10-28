import {env} from 'cloudflare:workers';
import {billingNowSql as clock,stripeConfiguration} from './stripe-provider';
// A canonical paid reconciliation can attach the current Kids purchase. It cannot
// invent paid coverage, retarget an old grant, or undo administrative revocation.
export async function bindPaidKidsService(owner:string,account:string){
 const c=stripeConfiguration();if(!c||!env.DB)return;
 const paid=`EXISTS(SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=c.owner_user_id AND b.workspace_id=c.account_id AND b.mode=? AND b.price_id=? AND b.status='active' AND b.paid_through>${clock} AND b.verified_at<=${clock} AND b.verified_at>${clock}-300000 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL)`;
 await env.DB.prepare(`INSERT INTO kids_service_access(owner_user_id,workspace_id,grant_id,revision,kind,beta_until,billing_workspace_id,revoked_at,created_at,updated_at) SELECT c.owner_user_id,c.workspace_id,?,1,'subscription',NULL,c.account_id,NULL,${clock},${clock} FROM kids_commerce c JOIN kids_state k ON k.user_id=c.owner_user_id AND k.id=c.workspace_id WHERE c.owner_user_id=? AND c.account_id=? AND ${paid} ON CONFLICT(owner_user_id,workspace_id) DO UPDATE SET kind='subscription',beta_until=NULL,billing_workspace_id=excluded.billing_workspace_id,revision=kids_service_access.revision+1,updated_at=excluded.updated_at WHERE kids_service_access.revoked_at IS NULL AND kids_service_access.kind='beta'`).bind(crypto.randomUUID(),owner,account,c.mode,c.price).run();
}
