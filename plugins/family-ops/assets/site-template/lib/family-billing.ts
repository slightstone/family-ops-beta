import Stripe from 'stripe';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {FamilyError} from './family';
import {resolveFamily,sharingEnabled,digest} from './family-sharing';
import {resolveBillingOwner,type BillingOwnerScope} from './billing-owner';
import {bindPaidKidsService} from './kids-commerce-binding';

import {stripeApiVersion as apiVersion,billingNowSql as nowSql,stripeConfiguration as configuration,stripeClient as provider,type StripeConfiguration as Configuration} from './stripe-provider';
const db=()=>{if(!env.DB)throw new FamilyError('Subscription verification is unavailable.',503);return env.DB;};
type Mode='test'|'live';
export type Billing={owner_user_id:string;workspace_id:string;mode:Mode;customer_id:string;subscription_id:string;price_id:string;status:string;paid_through:number|null;cancel_at_period_end:number;verified_at:number|null;requested_generation:number;verified_generation:number;lease_token:string|null;lease_until:number|null;retry_after:number|null;revision:number;now:number};
const busy=()=>new FamilyError('Subscription verification has not finished. Retry this same request shortly.',503,5);
export const loadBilling=(owner:string,workspace:string)=>db().prepare(`SELECT *,${nowSql} AS now FROM workspace_billing WHERE owner_user_id=? AND workspace_id=?`).bind(owner,workspace).first<Billing>();
async function owner(userId:string){
 const active=await resolveFamily(userId);
 if(!active)throw new FamilyError('Create a workspace first.',404);
 if(active.access.role!=='owner')throw new FamilyError('Only the household owner can manage a subscription.',403);
 return active.row;
}
export function billingStatus(b:Billing|null,c:Configuration){
 const fresh=!!b&&b.mode===c.mode&&b.price_id===c.price&&b.verified_at!==null&&b.verified_at<=b.now&&b.now-b.verified_at<300000;
 const clean=!!b&&b.requested_generation===b.verified_generation&&b.lease_token===null;
 return {enabled:true,status:b?.mode===c.mode?b.status:'not_connected',fresh:!!fresh,verificationPending:!!b&&!clean,paidThrough:b?.mode===c.mode?b.paid_through:null,cancelAtPeriodEnd:b?.mode===c.mode?!!b.cancel_at_period_end:false,
 subscriptionEligibility:!!(b&&fresh&&clean&&b.status==='active'&&b.paid_through!==null&&b.now<b.paid_through),connectedServicesAvailable:false,
 message:'Subscription eligibility only. No connected service is available. Manual planning and export remain available.'};
}
async function cleanup(){
 await db().batch([
 db().prepare(`DELETE FROM workspace_billing_events WHERE rowid IN (SELECT rowid FROM workspace_billing_events WHERE processed_at<=${nowSql}-2592000000 ORDER BY processed_at LIMIT 100)`),
 db().prepare(`DELETE FROM workspace_billing_refreshes WHERE rowid IN (SELECT rowid FROM workspace_billing_refreshes WHERE completed_at<=${nowSql}-2592000000 ORDER BY completed_at LIMIT 100)`),
 ]);
}
export async function getFamilyBilling(userId:string){const c=configuration();if(!c)return {enabled:false};const w=await owner(userId);await cleanup();return billingStatus(await loadBilling(userId,w.id),c);}
const ref=(v:unknown):string|null=>typeof v==='string'?v:typeof v==='object'&&v!==null&&'id' in v&&typeof v.id==='string'?v.id:null;
function canonical(subscription:Stripe.Subscription,invoice:Stripe.Invoice|null,b:Billing,c:Configuration){
 const denied={status:'unsupported',paidThrough:null as number|null,cancelAtPeriodEnd:false};
 const s=subscription;
 if(s.id!==b.subscription_id||ref(s.customer)!==b.customer_id||s.livemode!==(c.mode==='live')||b.price_id!==c.price||s.items.has_more||s.items.data.length!==1)return denied;
 const item=s.items.data[0];
 if(item.price.id!==c.price||item.price.livemode!==s.livemode||item.price.recurring?.usage_type!=='licensed'||item.quantity!==1)return denied;
 const known=['active','trialing','past_due','unpaid','incomplete','incomplete_expired','paused','canceled'];
 if(!known.includes(s.status))return denied;
 const result={status:s.status as string,paidThrough:null as number|null,cancelAtPeriodEnd:s.cancel_at_period_end};
 if(s.status!=='active'||s.pause_collection||s.pending_update)return result;
 const i=invoice;
 if(!i||i.id!==ref(s.latest_invoice)||ref(i.customer)!==b.customer_id||i.livemode!==s.livemode||ref(i.parent?.subscription_details?.subscription)!==s.id||i.status!=='paid'||i.amount_remaining!==0||i.lines.has_more||i.lines.data.length!==1)return result;
 const line=i.lines.data[0],parent=line.parent?.subscription_item_details;
 if(!parent||parent.proration||ref(parent.subscription)!==s.id||ref(parent.subscription_item)!==item.id||ref(line.pricing?.price_details?.price)!==c.price||line.quantity!==1)return result;
 if(!Number.isSafeInteger(item.current_period_start)||!Number.isSafeInteger(item.current_period_end)||!Number.isSafeInteger(line.period.start)||!Number.isSafeInteger(line.period.end))return result;
 const start=Math.max(item.current_period_start,line.period.start)*1000;
 const end=Math.min(item.current_period_end,line.period.end,s.cancel_at??Number.MAX_SAFE_INTEGER)*1000;
 if(start<=b.now&&b.now<end)result.paidThrough=end;
 return result;
}
async function reconcile(initial:Billing,c:Configuration){
 const token=crypto.randomUUID();
 const b=await db().prepare(`UPDATE workspace_billing SET lease_token=?,lease_until=${nowSql}+20000 WHERE owner_user_id=? AND workspace_id=? AND mode=? AND customer_id=? AND subscription_id=? AND price_id=? AND (lease_token IS NULL OR lease_until<=${nowSql}) AND (retry_after IS NULL OR retry_after<=${nowSql}) RETURNING *,${nowSql} AS now`).bind(token,initial.owner_user_id,initial.workspace_id,c.mode,initial.customer_id,initial.subscription_id,c.price).first<Billing>();
 if(!b)throw busy();
 let value:ReturnType<typeof canonical>;
 try{
 const stripe=provider(c);
 const subscription=await stripe.subscriptions.retrieve(b.subscription_id);
 const invoiceId=ref(subscription.latest_invoice);
 const invoice=subscription.status==='active'&&invoiceId?await stripe.invoices.retrieve(invoiceId):null;
 value=canonical(subscription,invoice,b,c);
 }catch{
 await db().prepare(`UPDATE workspace_billing SET lease_token=NULL,lease_until=NULL,retry_after=${nowSql}+5000 WHERE owner_user_id=? AND workspace_id=? AND lease_token=?`).bind(b.owner_user_id,b.workspace_id,token).run();
 throw busy();
 }
 // Keep the winning lease through the transaction so only its own receipts can be acknowledged.
 const fence=`owner_user_id=? AND workspace_id=? AND mode=? AND customer_id=? AND subscription_id=? AND price_id=? AND lease_token=? AND lease_until>${nowSql} AND requested_generation=?`;
 const args=[b.owner_user_id,b.workspace_id,c.mode,b.customer_id,b.subscription_id,c.price,token,b.requested_generation];
 // Once the first statement wins, the transaction's own revision proves that win.
 // Do not let a millisecond lease boundary interrupt the remaining receipt commits.
 const wonFence=fence.replace(` AND lease_until>${nowSql}`,'')+' AND revision=? AND verified_generation=?';
 const wonArgs=[...args,b.revision+1,b.requested_generation];
 const committed=await db().batch([
 db().prepare(`UPDATE workspace_billing SET status=?,paid_through=?,cancel_at_period_end=?,verified_at=${nowSql},verified_generation=?,retry_after=NULL,revision=revision+1 WHERE ${fence} RETURNING revision`).bind(value.status,value.paidThrough,value.cancelAtPeriodEnd?1:0,b.requested_generation,...args),
 db().prepare(`UPDATE workspace_billing_events SET processed_at=${nowSql} WHERE owner_user_id=? AND workspace_id=? AND processed_at IS NULL AND EXISTS(SELECT 1 FROM workspace_billing WHERE ${wonFence})`).bind(b.owner_user_id,b.workspace_id,...wonArgs),
 db().prepare(`UPDATE workspace_billing_refreshes SET completed_at=${nowSql} WHERE owner_user_id=? AND workspace_id=? AND completed_at IS NULL AND requested_generation<=? AND EXISTS(SELECT 1 FROM workspace_billing WHERE ${wonFence})`).bind(b.owner_user_id,b.workspace_id,b.requested_generation,...wonArgs),
 db().prepare(`UPDATE workspace_billing SET lease_token=NULL,lease_until=NULL WHERE ${wonFence}`).bind(...wonArgs),
 ]);
 if(committed[0].results.length!==1){await db().prepare('UPDATE workspace_billing SET lease_token=NULL,lease_until=NULL WHERE owner_user_id=? AND workspace_id=? AND lease_token=?').bind(b.owner_user_id,b.workspace_id,token).run();throw busy();}
 await bindPaidKidsService(b.owner_user_id,b.workspace_id);
 return loadBilling(b.owner_user_id,b.workspace_id);
}
const refresh=z.object({action:z.literal('refresh'),operationId:z.string().uuid(),createdAt:z.number().int().nonnegative(),workspaceId:z.string().uuid(),grantId:z.string().uuid(),confirmed:z.literal(true)}).strict();
type RefreshReceipt={body_hash:string;completed_at:number|null};
export async function refreshFamilyBilling(userId:string,input:unknown,scope?:BillingOwnerScope){
 const c=configuration();if(!c)throw new FamilyError('Subscriptions are not available yet.',404);
 const a=refresh.parse(input),w=await resolveBillingOwner(userId,scope);
 if(a.workspaceId!==w.id||a.grantId!==w.id)throw new FamilyError('Confirm this request in the current owner workspace.',403);
 const b=await loadBilling(userId,w.id);if(!b||b.mode!==c.mode||b.price_id!==c.price)throw new FamilyError('No subscription is connected.',404);
 const hash=await digest(JSON.stringify(a));
 const receipt=()=>db().prepare('SELECT body_hash,completed_at FROM workspace_billing_refreshes WHERE actor_id=? AND operation_id=?').bind(userId,a.operationId).first<RefreshReceipt>();
 let r=await receipt();
 if(!r){
 try{await db().prepare(`INSERT INTO workspace_billing_refreshes (actor_id,operation_id,owner_user_id,workspace_id,grant_id,mode,body_hash,created_at,received_at) SELECT ?,?,?,?,?,?,?,?,${nowSql} WHERE EXISTS(SELECT 1 FROM workspace_state WHERE user_id=? AND id=?) AND (?=0 OR NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?)) AND NOT EXISTS(SELECT 1 FROM workspace_billing_refreshes WHERE actor_id=? AND operation_id=?)`).bind(userId,a.operationId,userId,w.id,a.grantId,c.mode,hash,a.createdAt,userId,w.id,sharingEnabled()?1:0,userId,userId,a.operationId).run();}
 catch(error){const message=error instanceof Error?error.message:'';if(message.includes('BILLING_REFRESH_LIMIT'))throw new FamilyError('Too many subscription checks. Retry this same request in a minute.',429,60);if(message.includes('BILLING_REQUEST_EXPIRED'))throw new FamilyError('This subscription check expired. Start a new check.',409);if(message.includes('BILLING_OWNER_CHANGED'))throw new FamilyError('Access changed. Open the current owner workspace.',403);throw error;}
 r=await receipt();
 }
 if(!r)throw new FamilyError('Access changed. Open the current owner workspace.',403);
 if(r.body_hash!==hash)throw new FamilyError('This retry belongs to a different subscription check.',409);
 if(r.completed_at!==null){await bindPaidKidsService(userId,w.id);return {...billingStatus(await loadBilling(userId,w.id),c),retried:true};}
 const latest=await loadBilling(userId,w.id);if(!latest)throw busy();
 const result=await reconcile(latest,c);await cleanup();return {...billingStatus(result,c),retried:false};
}
const eventReference=z.object({id:z.string().regex(/^evt_[A-Za-z0-9]+$/),type:z.string(),api_version:z.literal(apiVersion),livemode:z.boolean(),data:z.object({object:z.object({id:z.string(),customer:z.union([z.string(),z.object({id:z.string()})]),parent:z.object({subscription_details:z.object({subscription:z.union([z.string(),z.object({id:z.string()})])}).nullish()}).nullish()})})});
const eventTypes=new Set(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed','invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.voided','invoice.marked_uncollectible','invoice.finalization_failed']);
export async function receiveSubscriptionEvent(event:Stripe.Event,hash:string,c:Configuration){
 const parsed=eventReference.safeParse(event);
 if(!parsed.success||parsed.data.livemode!==(c.mode==='live'))throw new FamilyError('Unsupported webhook.',400);
 const e=parsed.data;
 if(!eventTypes.has(e.type))return {received:true,ignored:true};
 const earlier=await db().prepare('SELECT body_hash FROM workspace_billing_events WHERE mode=? AND event_id=?').bind(c.mode,e.id).first<{body_hash:string}>();
 if(earlier&&earlier.body_hash!==hash)throw new FamilyError('Webhook receipt conflict.',409);
 const object=e.data.object;
 const sub=e.type.startsWith('customer.subscription.')?object.id:ref(object.parent?.subscription_details?.subscription);
 const customer=ref(object.customer);
 if(!sub||!customer)throw new FamilyError('Unsupported webhook.',400);
 const b=await db().prepare(`SELECT *,${nowSql} AS now FROM workspace_billing WHERE mode=? AND subscription_id=? AND customer_id=? AND price_id=?`).bind(c.mode,sub,customer,c.price).first<Billing>();
 if(!b)return {received:true,ignored:true};
 await db().prepare(`INSERT INTO workspace_billing_events (mode,event_id,owner_user_id,workspace_id,subscription_id,event_type,body_hash,received_at) SELECT ?,?,?,?,?,?,?,${nowSql} WHERE EXISTS(SELECT 1 FROM workspace_billing WHERE owner_user_id=? AND workspace_id=? AND mode=? AND subscription_id=? AND customer_id=? AND price_id=?) AND NOT EXISTS(SELECT 1 FROM workspace_billing_events WHERE mode=? AND event_id=?)`).bind(c.mode,e.id,b.owner_user_id,b.workspace_id,sub,e.type,hash,b.owner_user_id,b.workspace_id,c.mode,sub,customer,c.price,c.mode,e.id).run();
 const receipt=await db().prepare('SELECT body_hash,processed_at FROM workspace_billing_events WHERE mode=? AND event_id=?').bind(c.mode,e.id).first<{body_hash:string;processed_at:number|null}>();
 if(!receipt)return {received:true,ignored:true};
 if(receipt.body_hash!==hash)throw new FamilyError('Webhook receipt conflict.',409);
 const latest=await loadBilling(b.owner_user_id,b.workspace_id);
 if(!latest)return {received:true,ignored:true};
 if(receipt.processed_at===null||latest.requested_generation!==latest.verified_generation)await reconcile(latest,c);
 else await bindPaidKidsService(latest.owner_user_id,latest.workspace_id);
 await cleanup();return {received:true};
}

// Production checkout binding/notification caller; never grants from a return URL.
export async function verifyBilling(ownerId:string,workspaceId:string,c:Configuration){
 let b=await loadBilling(ownerId,workspaceId);if(!b||b.mode!==c.mode||b.price_id!==c.price)throw busy();
 if(b.requested_generation===b.verified_generation&&b.lease_token===null&&b.verified_at!==null&&b.verified_at<=b.now&&b.now-b.verified_at<300000){await bindPaidKidsService(ownerId,workspaceId);return b;}
 if(b.requested_generation===b.verified_generation){
 const dirty=await db().prepare('UPDATE workspace_billing SET requested_generation=requested_generation+1,revision=revision+1 WHERE owner_user_id=? AND workspace_id=? AND mode=? AND subscription_id=? AND revision=? RETURNING *,'+nowSql+' AS now').bind(ownerId,workspaceId,c.mode,b.subscription_id,b.revision).first<Billing>();
 if(!dirty)throw busy();b=dirty;
 }
 return reconcile(b,c);
}
