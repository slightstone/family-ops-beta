import type Stripe from 'stripe';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {FamilyError} from './family';
import {sharingEnabled,digest} from './family-sharing';
import {resolveBillingOwner,type BillingOwnerScope} from './billing-owner';
import {loadBilling,verifyBilling,billingStatus} from './family-billing';
import {stripeConfiguration,stripeClient,billingNowSql as clock,type StripeConfiguration} from './stripe-provider';

const db=()=>{if(!env.DB)throw new FamilyError('Subscription checkout is unavailable.',503);return env.DB;};
const busy=()=>new FamilyError('This payment step is not confirmed. Retry the same step shortly; another checkout will not be started.',503,5);
const ref=(v:unknown):string|null=>typeof v==='string'?v:typeof v==='object'&&v!==null&&'id' in v&&typeof v.id==='string'?v.id:null;
export function checkoutConfiguration(){
 const billing=stripeConfiguration();if(!billing||env.FAMILY_OPS_CHECKOUT!=='enabled'||!/^bpc_[A-Za-z0-9]{1,128}$/.test(env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID??'')||!/^v[A-Za-z0-9._-]{1,63}$/.test(env.FAMILY_OPS_OFFER_VERSION??''))return null;
 try{const u=new URL(env.FAMILY_OPS_PUBLIC_ORIGIN??'');if(u.protocol!=='https:'||u.origin!==env.FAMILY_OPS_PUBLIC_ORIGIN||u.username||u.password||u.port)return null;}catch{return null;}
 return {...billing,origin:env.FAMILY_OPS_PUBLIC_ORIGIN!,offer:env.FAMILY_OPS_OFFER_VERSION!,portal:env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID!};
}
type Configuration=NonNullable<ReturnType<typeof checkoutConfiguration>>;
export function requireCheckoutOrigin(request:Request){const c=checkoutConfiguration(),expected=c?.origin??new URL(request.url).origin;if(request.headers.get('origin')!==expected||(c&&new URL(request.url).origin!==expected))throw new FamilyError('Open payment settings on the canonical Family Ops website.',403);}
const providerId=(value:unknown,prefix:string)=>typeof value==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9]{1,240}$').test(value);
const sessionId=(value:unknown,mode:string)=>typeof value==='string'&&new RegExp('^cs_'+mode+'_[A-Za-z0-9]{1,240}$').test(value);

type Checkout={kids_workspace_id:string|null;surface:'planner'|'kids';id:string;owner_user_id:string;workspace_id:string;grant_id:string;mode:string;body_hash:string;created_at:number;received_at:number;price_id:string;product_id:string;offer_version:string;origin:string;amount:number;currency:string;prior_subscription_id:string|null;customer_id:string|null;session_id:string|null;expires_at:number;state:'creating'|'uncertain'|'open'|'bound'|'expired';requested_generation:number;verified_generation:number;revision:number;verified_at:number|null;lease_token:string|null;lease_until:number|null;retry_after:number|null;expire_operation_id:string|null;expire_body_hash:string|null;expire_created_at:number|null;expire_received_at:number|null;now:number};
type Portal={kids_workspace_id:string|null;surface:'planner'|'kids';owner_user_id:string;operation_id:string;workspace_id:string;grant_id:string;mode:string;billing_revision:number;body_hash:string;created_at:number;received_at:number;customer_id:string;subscription_id:string;configuration_id:string;origin:string;provider_session_id:string|null;completed_at:number|null;now:number};
const scope={workspaceId:z.string().uuid(),grantId:z.string().uuid()};
const intent={operationId:z.string().uuid(),createdAt:z.number().int().nonnegative(),confirmed:z.literal(true)};
const request=z.discriminatedUnion('action',[
 z.object({...scope,action:z.literal('quote')}).strict(),
 z.object({...scope,...intent,action:z.literal('start'),quoteHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({...scope,action:z.literal('sync'),intentId:z.string().uuid()}).strict(),
 z.object({...scope,...intent,action:z.literal('expire'),intentId:z.string().uuid()}).strict(),
 z.object({...scope,...intent,action:z.literal('portal'),billingRevision:z.number().int().nonnegative()}).strict(),
]);
const terminal=(alias:string)=>`${alias}.status IN ('canceled','incomplete_expired') AND ${alias}.verified_at IS NOT NULL AND ${alias}.verified_at<=${clock} AND ${alias}.verified_at>${clock}-300000 AND ${alias}.requested_generation=${alias}.verified_generation AND ${alias}.lease_token IS NULL`;
const owned=(user:string,workspace:string)=>db().prepare(`SELECT *,${clock} AS now FROM workspace_billing_checkouts WHERE owner_user_id=? AND workspace_id=? ORDER BY CASE WHEN state IN ('creating','uncertain','open') THEN 0 ELSE 1 END,received_at DESC,id DESC LIMIT 1`).bind(user,workspace).first<Checkout>();
const load=(id:string)=>db().prepare(`SELECT *,${clock} AS now FROM workspace_billing_checkouts WHERE id=?`).bind(id).first<Checkout>();
async function cleanup(){await db().batch([
 db().prepare(`DELETE FROM workspace_billing_checkouts WHERE id IN (SELECT id FROM workspace_billing_checkouts WHERE state IN ('bound','expired') AND verified_at<=${clock}-2592000000 AND NOT EXISTS(SELECT 1 FROM workspace_checkout_events e WHERE e.intent_id=workspace_billing_checkouts.id AND e.processed_at IS NULL) ORDER BY verified_at LIMIT 100)`),
 db().prepare(`DELETE FROM workspace_billing_portals WHERE rowid IN (SELECT rowid FROM workspace_billing_portals WHERE completed_at<=${clock}-2592000000 ORDER BY completed_at LIMIT 100)`),
 ]);}
function publicCheckout(r:Checkout|null){return r?{id:r.id,state:r.state,expiresAt:r.expires_at,canCancel:!!r.session_id&&r.state!=='bound'&&r.state!=='expired',uncertain:r.state==='uncertain',expiryRequest:r.expire_operation_id?{operationId:r.expire_operation_id,createdAt:r.expire_created_at}:null}:null;}
export async function getFamilyCheckout(userId:string,requestedIntent?:string|null,scope?:BillingOwnerScope){
 const c=checkoutConfiguration();if(!c)return {enabled:false};const w=await resolveBillingOwner(userId,scope);if(!scope)await cleanup();
 if(requestedIntent)z.string().uuid().parse(requestedIntent);
 const r=requestedIntent?await load(requestedIntent):await owned(userId,w.id);
 if(r&&(r.owner_user_id!==userId||r.workspace_id!==w.id))throw new FamilyError('Checkout not found in this household.',404);
 const billing=await loadBilling(userId,w.id);
 const portal=await db().prepare(`SELECT operation_id,created_at,billing_revision FROM workspace_billing_portals WHERE owner_user_id=? AND workspace_id=? AND customer_id=? AND subscription_id=? AND received_at>${clock}-82800000 ORDER BY received_at DESC LIMIT 1`).bind(userId,w.id,billing?.customer_id??'',billing?.subscription_id??'').first<{operation_id:string;created_at:number;billing_revision:number}>();
 return {enabled:true,testMode:c.mode==='test',workspaceId:w.id,offerVersion:c.offer,checkout:publicCheckout(r),billing:billingStatus(billing,c),billingRevision:billing?.revision??null,portal:portal?{operationId:portal.operation_id,createdAt:portal.created_at,billingRevision:portal.billing_revision}:null};
}
function handoff(value:string|null,host:string){if(!value||value.length>8192)throw busy();try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!==host||u.port||u.username||u.password)throw busy();return value;}catch{throw busy();}}
function priceValid(p:Stripe.Price,c:StripeConfiguration){return p.id===c.price&&p.livemode===(c.mode==='live')&&p.type==='recurring'&&p.billing_scheme==='per_unit'&&!p.transform_quantity&&!p.tiers_mode&&p.unit_amount!==null&&Number.isSafeInteger(p.unit_amount)&&p.unit_amount>0&&['usd','ils','eur','gbp'].includes(p.currency)&&p.recurring?.interval==='month'&&p.recurring.interval_count===1&&p.recurring.usage_type==='licensed'&&providerId(ref(p.product),'prod');}
async function portalConfiguration(c:Configuration,id=c.portal){
 const p=await stripeClient(c).billingPortal.configurations.retrieve(id),f=p.features;
 const legal=(url:string|null)=>{try{return !!url&&new URL(url).origin===c.origin&&new URL(url).protocol==='https:';}catch{return false;}};
 if(p.id!==id||!p.active||p.livemode!==(c.mode==='live')||!f.subscription_cancel.enabled||f.subscription_cancel.mode!=='immediately'||f.subscription_cancel.proration_behavior!=='none'||f.customer_update.enabled||f.subscription_update.enabled||f.payment_method_update.enabled||p.login_page.enabled||!legal(p.business_profile.terms_of_service_url)||!legal(p.business_profile.privacy_policy_url))throw new FamilyError('The subscription offer is not ready. No checkout was started.',503);
 return p;
}
async function quote(c:Configuration){
 try{const p=await stripeClient(c).prices.retrieve(c.price),portal=await portalConfiguration(c);if(!p.active||!priceValid(p,c))throw new Error('Unsupported offer');
 const facts={priceId:p.id,productId:ref(p.product)!,amount:p.unit_amount!,currency:p.currency,interval:'month',offerVersion:c.offer,origin:c.origin,portalId:portal.id,termsUrl:portal.business_profile.terms_of_service_url!,privacyUrl:portal.business_profile.privacy_policy_url!};
 return {facts,public:{amount:facts.amount,currency:facts.currency,interval:'month',offerVersion:c.offer,termsUrl:facts.termsUrl,privacyUrl:facts.privacyUrl,quoteHash:await digest(JSON.stringify(facts))}};
 }catch{throw new FamilyError('The subscription offer could not be checked. Retry before starting checkout.',503,5);}
}
function writeError(error:unknown):never{const m=error instanceof Error?error.message:'';if(m.includes('CHECKOUT_REQUEST_EXPIRED')||m.includes('PORTAL_REQUEST_EXPIRED'))throw new FamilyError('This payment request expired. Open a new offer before continuing.',409);if(m.includes('CHECKOUT_RATE')||m.includes('PORTAL_RATE'))throw new FamilyError('Too many payment requests. Wait a minute before starting another.',429,60);if(m.includes('CHECKOUT_START_BLOCKED'))throw new FamilyError('An existing checkout or subscription must be resolved before another checkout can start. Recheck its status.',409);if(m.includes('UNIQUE constraint'))throw new FamilyError('A checkout is already in progress, or this provider session is already assigned. Recheck the existing checkout.',409);throw error;}
async function start(userId:string,a:Extract<z.infer<typeof request>,{action:'start'}>,c:Configuration,target:{surface:'planner'|'kids';kidsWorkspaceId?:string}){
 const hash=await digest(JSON.stringify(a));let r=await load(a.operationId);
 if(r){if(r.owner_user_id!==userId||r.workspace_id!==a.workspaceId||r.body_hash!==hash)throw new FamilyError('This retry belongs to a different checkout.',409);return synchronize(r,c);}
 if(await db().prepare("SELECT 1 FROM workspace_billing_checkouts WHERE owner_user_id=? AND workspace_id=? AND state IN ('creating','uncertain','open')").bind(userId,a.workspaceId).first())throw new FamilyError('A checkout is already in progress. Recheck or resume that checkout.',409);
 const q=await quote(c);if(q.public.quoteHash!==a.quoteHash)throw new FamilyError('The offer changed. Read the current price and confirm it again.',409);
 const b=await loadBilling(userId,a.workspaceId);
 try{await db().prepare(`INSERT INTO workspace_billing_checkouts(surface,kids_workspace_id,id,owner_user_id,workspace_id,grant_id,mode,body_hash,created_at,received_at,price_id,product_id,offer_version,origin,amount,currency,prior_subscription_id,customer_id,expires_at) SELECT ?,?,?,?,?,?,?,?,?,${clock},?,?,?,?,?,?,?,?,(CAST(${clock}/1000 AS INTEGER)+3600)*1000 FROM workspace_state w WHERE w.user_id=? AND w.id=? AND (?=0 OR NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?))`).bind(target.surface,target.kidsWorkspaceId??null,a.operationId,userId,a.workspaceId,a.grantId,c.mode,hash,a.createdAt,c.price,q.facts.productId,c.offer,c.origin,q.facts.amount,q.facts.currency,b?.subscription_id??null,b?.customer_id??null,userId,a.workspaceId,sharingEnabled()?1:0,userId).run();}catch(error){writeError(error);}
 r=await load(a.operationId);if(!r)throw new FamilyError('Access changed. No checkout was started.',403);if(r.body_hash!==hash||r.owner_user_id!==userId)throw new FamilyError('This retry belongs to a different checkout.',409);
 return synchronize(r,c);
}
function scopeMatches(s:Stripe.Checkout.Session,r:Checkout){return sessionId(s.id,r.mode)&&s.id===r.session_id&&s.mode==='subscription'&&s.livemode===(r.mode==='live')&&s.adaptive_pricing?.enabled===false&&s.payment_method_types?.length===1&&s.payment_method_types[0]==='card'&&s.automatic_tax?.enabled===false&&s.allow_promotion_codes===false&&s.consent_collection?.terms_of_service==='required'&&s.client_reference_id===r.id&&s.metadata?.family_ops_workspace===r.workspace_id&&s.metadata?.family_ops_intent===r.id&&s.expires_at*1000===r.expires_at&&(!r.customer_id||ref(s.customer)===r.customer_id);}
function fence(r:Checkout,token:string){return {sql:`id=? AND lease_token=? AND lease_until>${clock} AND requested_generation=? AND revision=?`,args:[r.id,token,r.requested_generation,r.revision]};}
async function fail(r:Checkout,token:string){await db().prepare(`UPDATE workspace_billing_checkouts SET state=CASE WHEN state IN ('bound','expired') THEN state ELSE 'uncertain' END,lease_token=NULL,lease_until=NULL,retry_after=${clock}+5000 WHERE id=? AND lease_token=?`).bind(r.id,token).run();}
async function verifyLinked(r:Checkout,c:Configuration){const b=await verifyBilling(r.owner_user_id,r.workspace_id,c);return {checkout:publicCheckout(r),billing:billingStatus(b,c),billingRevision:b?.revision??null};}
async function synchronize(initial:Checkout,c:Configuration,expire=false){
 if(initial.mode!==c.mode||initial.price_id!==c.price)throw new FamilyError('This checkout needs its original offer configuration. Contact support before making another purchase.',409);
 if(initial.state==='bound'&&initial.requested_generation===initial.verified_generation&&!initial.lease_token)return verifyLinked(initial,c);
 if(initial.state==='expired'&&initial.requested_generation===initial.verified_generation&&!initial.lease_token)return {checkout:publicCheckout(initial)};
 const token=crypto.randomUUID();
 const r=await db().prepare(`UPDATE workspace_billing_checkouts SET lease_token=?,lease_until=${clock}+60000 WHERE id=? AND (lease_token IS NULL OR lease_until<=${clock}) AND (retry_after IS NULL OR retry_after<=${clock}) RETURNING *,${clock} AS now`).bind(token,initial.id).first<Checkout>();if(!r)throw busy();
 const stripe=stripeClient(c);let session:Stripe.Checkout.Session;
 try{
 if(!r.session_id){
 if(r.now-r.received_at>=82800000||r.offer_version!==c.offer||r.origin!==c.origin)throw busy();
 const back=`${r.origin}${r.surface==='kids'?'/kids?':'/app?view=settings&'}billingReturn=${r.id}`;
 session=await stripe.checkout.sessions.create({mode:'subscription',line_items:[{price:r.price_id,quantity:1}],allowed_payment_method_types:['card'],adaptive_pricing:{enabled:false},automatic_tax:{enabled:false},allow_promotion_codes:false,consent_collection:{terms_of_service:'required'},client_reference_id:r.id,metadata:{family_ops_intent:r.id,family_ops_workspace:r.workspace_id},success_url:back,cancel_url:back+'&checkoutCanceled=1',expires_at:r.expires_at/1000,...(r.customer_id?{customer:r.customer_id}:{})},{idempotencyKey:`familyops:checkout:${r.workspace_id}:${r.id}`});
 if(!sessionId(session.id,r.mode)||!scopeMatches(session,{...r,session_id:session.id}))throw busy();
 const f=fence(r,token);const saved=await db().prepare(`UPDATE workspace_billing_checkouts SET session_id=? WHERE ${f.sql} AND session_id IS NULL RETURNING id`).bind(session.id,...f.args).first();if(!saved)throw busy();r.session_id=session.id;
 }
 session=await stripe.checkout.sessions.retrieve(r.session_id);
 if(!scopeMatches(session,r)||!['open','complete','expired'].includes(session.status??''))throw busy();
 if(expire&&session.status==='open'){
 if(!r.expire_operation_id||r.expire_received_at===null||r.now-r.expire_received_at>=82800000)throw busy();
 await stripe.checkout.sessions.expire(r.session_id,{}, {idempotencyKey:`familyops:expire:${r.workspace_id}:${r.id}`});
 session=await stripe.checkout.sessions.retrieve(r.session_id);if(!scopeMatches(session,r)||!['complete','expired'].includes(session.status??''))throw busy();
 }
 const lines=await stripe.checkout.sessions.listLineItems(r.session_id,{limit:2});
 const item=lines.data[0];
 if(lines.has_more||lines.data.length!==1||!item?.price||!priceValid(item.price,c)||ref(item.price.product)!==r.product_id||item.quantity!==1||item.amount_subtotal!==r.amount||item.amount_total!==r.amount||item.price.unit_amount!==r.amount||item.price.currency!==r.currency||session.amount_total!==r.amount||session.amount_subtotal!==r.amount||session.currency!==r.currency||session.total_details?.amount_discount!==0||session.total_details?.amount_tax!==0||session.total_details?.amount_shipping!==0)throw busy();
 }catch{await fail(r,token);throw busy();}
 const f=fence(r,token),won=f.sql.replace(` AND lease_until>${clock}`,'').replace('revision=?','revision=?');
 let state:'open'|'expired'|'bound';let customer:string|null=null,subscription:string|null=null;
 if(session.status==='complete'){
 customer=ref(session.customer);subscription=ref(session.subscription);
 if(!providerId(customer,'cus')||!providerId(subscription,'sub')||session.consent?.terms_of_service!=='accepted'||!['paid','unpaid','no_payment_required'].includes(session.payment_status)){await fail(r,token);throw busy();}
 if(r.prior_subscription_id){const previous=await loadBilling(r.owner_user_id,r.workspace_id);if(!previous||previous.subscription_id!==r.prior_subscription_id||previous.customer_id!==customer){await fail(r,token);throw busy();}try{await verifyBilling(r.owner_user_id,r.workspace_id,c);}catch{await fail(r,token);throw busy();}}
 state='bound';
 }else state=session.status==='expired'?'expired':'open';
 if((r.state==='bound'&&state!=='bound')||(r.state==='expired'&&state!=='expired')){await fail(r,token);throw busy();}
 try{
 const actions:D1PreparedStatement[]=[];
 if(state==='bound'){
 const guard=`EXISTS(SELECT 1 FROM workspace_billing_checkouts WHERE ${f.sql})`;
 actions.push(db().prepare(`INSERT INTO workspace_billing(owner_user_id,workspace_id,mode,customer_id,subscription_id,price_id,checkout_intent_id,requested_generation) SELECT ?,?,?,?,?,?,?,1 WHERE ? IS NULL AND ${guard} AND NOT EXISTS(SELECT 1 FROM workspace_billing WHERE owner_user_id=? AND workspace_id=?) ON CONFLICT(owner_user_id,workspace_id) DO NOTHING`).bind(r.owner_user_id,r.workspace_id,r.mode,customer,subscription,r.price_id,r.id,r.prior_subscription_id,...f.args,r.owner_user_id,r.workspace_id));
 actions.push(db().prepare(`UPDATE workspace_billing SET subscription_id=?,checkout_intent_id=?,status='unknown',paid_through=NULL,cancel_at_period_end=0,verified_at=NULL,requested_generation=requested_generation+1,revision=revision+1 WHERE owner_user_id=? AND workspace_id=? AND mode=? AND customer_id=? AND subscription_id=? AND ${terminal('workspace_billing')} AND ${guard}`).bind(subscription,r.id,r.owner_user_id,r.workspace_id,r.mode,customer,r.prior_subscription_id,...f.args));
 }
 const binding=state==='bound'?' AND EXISTS(SELECT 1 FROM workspace_billing WHERE owner_user_id=? AND workspace_id=? AND mode=? AND customer_id=? AND subscription_id=? AND checkout_intent_id=?)':'';
 const values=state==='bound'?[r.owner_user_id,r.workspace_id,r.mode,customer,subscription,r.id]:[];
 actions.push(db().prepare(`UPDATE workspace_billing_checkouts SET state=?,verified_at=${clock},verified_generation=requested_generation,revision=revision+1,retry_after=NULL WHERE ${f.sql}${binding} RETURNING id`).bind(state,...f.args,...values));
 const proofArgs=[r.id,token,r.requested_generation,r.revision+1];
 actions.push(db().prepare(`UPDATE workspace_checkout_events SET processed_at=${clock} WHERE intent_id=? AND processed_at IS NULL AND EXISTS(SELECT 1 FROM workspace_billing_checkouts WHERE ${won} AND verified_generation=requested_generation)`).bind(r.id,...proofArgs));
 actions.push(db().prepare(`UPDATE workspace_billing_checkouts SET lease_token=NULL,lease_until=NULL WHERE ${won} AND verified_generation=requested_generation`).bind(...proofArgs));
 const result=await db().batch(actions);if(result[state==='bound'?2:0].results.length!==1)throw busy();
 }catch{await fail(r,token);throw busy();}
 const saved=await load(r.id);if(!saved)throw busy();
 if(saved.state==='bound')return verifyLinked(saved,c);
 return {checkout:publicCheckout(saved),...(saved.state==='open'&&saved.offer_version===c.offer?{url:handoff(session.url,'checkout.stripe.com')}:{})};
}
async function expireCheckout(userId:string,a:Extract<z.infer<typeof request>,{action:'expire'}>,c:Configuration){
 let r=await load(a.intentId);if(!r||r.owner_user_id!==userId||r.workspace_id!==a.workspaceId)throw new FamilyError('Checkout not found in this household.',404);
 if(!r.session_id&&r.state!=='bound'&&r.state!=='expired')throw new FamilyError('Checkout creation is not confirmed. Retry that checkout first to recover its reference before canceling. This action did not start a checkout.',409);
 const hash=await digest(JSON.stringify(a));
 if(r.expire_operation_id){if(r.expire_operation_id!==a.operationId||r.expire_body_hash!==hash)throw new FamilyError('Retry the existing checkout cancellation before starting another.',409);}
 else{try{await db().prepare(`UPDATE workspace_billing_checkouts SET expire_operation_id=?,expire_body_hash=?,expire_created_at=?,expire_received_at=${clock} WHERE id=? AND expire_operation_id IS NULL AND owner_user_id=? AND workspace_id=? AND (?=0 OR NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?))`).bind(a.operationId,hash,a.createdAt,r.id,userId,a.workspaceId,sharingEnabled()?1:0,userId).run();}catch(error){writeError(error);}}
 r=await load(r.id);if(!r||r.expire_operation_id!==a.operationId||r.expire_body_hash!==hash)throw new FamilyError('Access changed. Reopen the current checkout.',403);
 return synchronize(r,c,true);
}
async function portal(userId:string,a:Extract<z.infer<typeof request>,{action:'portal'}>,c:Configuration,target:{surface:'planner'|'kids';kidsWorkspaceId?:string}){
 const hash=await digest(JSON.stringify(a));let p=await db().prepare(`SELECT *,${clock} AS now FROM workspace_billing_portals WHERE owner_user_id=? AND operation_id=?`).bind(userId,a.operationId).first<Portal>();
 const b=await loadBilling(userId,a.workspaceId);if(!b||b.mode!==c.mode||b.price_id!==c.price||!providerId(b.customer_id,'cus')||!providerId(b.subscription_id,'sub'))throw new FamilyError('No subscription is connected.',404);
 if(!p){if(b.revision!==a.billingRevision)throw new FamilyError('Subscription status changed. Recheck before opening cancellation.',409);await portalConfiguration(c);
 try{await db().prepare(`INSERT INTO workspace_billing_portals(surface,kids_workspace_id,owner_user_id,operation_id,workspace_id,grant_id,mode,billing_revision,body_hash,created_at,received_at,customer_id,subscription_id,configuration_id,origin) SELECT ?,?,?,?,?,?,?,?,?,?,${clock},?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_state WHERE user_id=? AND id=?) AND EXISTS(SELECT 1 FROM workspace_billing WHERE owner_user_id=? AND workspace_id=? AND mode=? AND customer_id=? AND subscription_id=? AND revision=?) AND (?=0 OR NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?)) AND NOT EXISTS(SELECT 1 FROM workspace_billing_portals WHERE owner_user_id=? AND operation_id=?)`).bind(target.surface,target.kidsWorkspaceId??null,userId,a.operationId,a.workspaceId,a.grantId,c.mode,a.billingRevision,hash,a.createdAt,b.customer_id,b.subscription_id,c.portal,c.origin,userId,a.workspaceId,userId,a.workspaceId,c.mode,b.customer_id,b.subscription_id,a.billingRevision,sharingEnabled()?1:0,userId,userId,a.operationId).run();}catch(error){writeError(error);}
 p=await db().prepare(`SELECT *,${clock} AS now FROM workspace_billing_portals WHERE owner_user_id=? AND operation_id=?`).bind(userId,a.operationId).first<Portal>();}
 if(!p)throw new FamilyError('Access changed. Reopen the current owner workspace.',403);
 if(p.body_hash!==hash||p.workspace_id!==a.workspaceId)throw new FamilyError('This retry belongs to a different cancellation link.',409);
 if(p.now-p.received_at>=82800000)throw new FamilyError('This cancellation link request expired. Create a new link explicitly.',409);
 if(p.mode!==c.mode||p.customer_id!==b.customer_id||p.subscription_id!==b.subscription_id)throw new FamilyError('The subscription changed. Open a new cancellation request.',409);
 try{await portalConfiguration(c,p.configuration_id);const back=`${p.origin}${p.surface==='kids'?'/kids?':'/app?view=settings&'}portalReturn=${p.operation_id}`;
 const session=await stripeClient(c).billingPortal.sessions.create({customer:p.customer_id,configuration:p.configuration_id,return_url:back,flow_data:{type:'subscription_cancel',subscription_cancel:{subscription:p.subscription_id},after_completion:{type:'redirect',redirect:{return_url:back}}}},{idempotencyKey:`familyops:portal:${p.workspace_id}:${p.operation_id}`});
 const url=handoff(session.url,'billing.stripe.com');if(!providerId(session.id,'bps')||session.customer!==p.customer_id||ref(session.configuration)!==p.configuration_id||session.flow?.type!=='subscription_cancel'||ref(session.flow.subscription_cancel?.subscription)!==p.subscription_id)throw busy();
 const saved=await db().prepare(`UPDATE workspace_billing_portals SET provider_session_id=?,completed_at=${clock} WHERE owner_user_id=? AND operation_id=? AND body_hash=? AND EXISTS(SELECT 1 FROM workspace_billing WHERE owner_user_id=? AND workspace_id=? AND mode=? AND customer_id=? AND subscription_id=?) AND (?=0 OR NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?)) RETURNING operation_id`).bind(session.id,userId,a.operationId,hash,userId,p.workspace_id,p.mode,p.customer_id,p.subscription_id,sharingEnabled()?1:0,userId).first();if(!saved)throw busy();
 return {portal:{operationId:p.operation_id},url,message:'Opening a cancellation link does not cancel the subscription. Confirm on Stripe, then return to recheck.'};
 }catch{throw busy();}
}
export async function changeFamilyCheckout(userId:string,input:unknown,scope?:BillingOwnerScope){
 const c=checkoutConfiguration();if(!c)throw new FamilyError('Subscription checkout is not available yet.',404);
 const a=request.parse(input),w=await resolveBillingOwner(userId,scope,a);await cleanup();let result;
 if(a.action==='quote')return {quote:(await quote(c)).public};
 if(a.action==='start')result=await start(userId,a,c,{surface:w.surface,...(scope?{kidsWorkspaceId:scope.kidsWorkspaceId}:{})});
 else if(a.action==='expire')result=await expireCheckout(userId,a,c);
 else if(a.action==='portal')result=await portal(userId,a,c,{surface:w.surface,...(scope?{kidsWorkspaceId:scope.kidsWorkspaceId}:{})});
 else{const r=await load(a.intentId);if(!r||r.owner_user_id!==userId||r.workspace_id!==a.workspaceId)throw new FamilyError('Checkout not found in this household.',404);result=await synchronize(r,c,!!r.expire_operation_id);}
 await resolveBillingOwner(userId,scope,a);return result;
}
const checkoutEvent=z.object({id:z.string().regex(/^evt_[A-Za-z0-9]+$/),type:z.enum(['checkout.session.completed','checkout.session.expired']),livemode:z.boolean(),data:z.object({object:z.object({id:z.string().max(255).regex(/^cs_(test|live)_[A-Za-z0-9]+$/)})})});
export async function receiveCheckoutEvent(event:Stripe.Event,hash:string){
 const c=checkoutConfiguration();if(!c)return {received:true,ignored:true};const parsed=checkoutEvent.safeParse(event);if(!parsed.success||parsed.data.livemode!==(c.mode==='live'))throw new FamilyError('Unsupported webhook.',400);
 const e=parsed.data;const r=await db().prepare(`SELECT *,${clock} AS now FROM workspace_billing_checkouts WHERE mode=? AND session_id=?`).bind(c.mode,e.data.object.id).first<Checkout>();if(!r)return {received:true,ignored:true};
 await db().prepare(`INSERT INTO workspace_checkout_events(mode,event_id,intent_id,event_type,body_hash,received_at) SELECT ?,?,?,?,?,${clock} WHERE EXISTS(SELECT 1 FROM workspace_billing_checkouts WHERE id=? AND mode=? AND session_id=?) AND NOT EXISTS(SELECT 1 FROM workspace_checkout_events WHERE mode=? AND event_id=?)`).bind(c.mode,e.id,r.id,e.type,hash,r.id,c.mode,e.data.object.id,c.mode,e.id).run();
 const receipt=await db().prepare('SELECT body_hash,processed_at,intent_id FROM workspace_checkout_events WHERE mode=? AND event_id=?').bind(c.mode,e.id).first<{body_hash:string;processed_at:number|null;intent_id:string}>();if(!receipt)return {received:true,ignored:true};if(receipt.body_hash!==hash||receipt.intent_id!==r.id)throw new FamilyError('Webhook receipt conflict.',409);
 const latest=await load(r.id);if(!latest)return {received:true,ignored:true};
 if(receipt.processed_at===null||latest.requested_generation!==latest.verified_generation)await synchronize(latest,c);
 else if(latest.state==='bound')await verifyLinked(latest,c);
 await cleanup();return {received:true};
}
