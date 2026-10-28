import Stripe from 'stripe';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {FamilyError} from './family';
import {boundedRequest} from './bounded-request';
import {stripeConfiguration,stripeClient,stripeApiVersion,billingNowSql as clock} from './stripe-provider';
import {receiveSubscriptionEvent} from './family-billing';
import {receiveCheckoutEvent} from './family-checkout';
const envelope=z.object({id:z.string().regex(/^evt_[A-Za-z0-9]+$/),type:z.string(),api_version:z.literal(stripeApiVersion),livemode:z.boolean()});
export async function receiveStripeWebhook(request:Request){
 const c=stripeConfiguration();if(!c)throw new FamilyError('Not found.',404);
 const raw=await boundedRequest(request,262144),signature=request.headers.get('stripe-signature');if(!signature)throw new FamilyError('Webhook verification failed.',400);
 let event:Stripe.Event;try{event=await stripeClient(c).webhooks.constructEventAsync(raw,signature,c.webhook,300,Stripe.createSubtleCryptoProvider());}catch{throw new FamilyError('Webhook verification failed.',400);}
 const parsed=envelope.safeParse(event);if(!parsed.success||parsed.data.livemode!==(c.mode==='live'))throw new FamilyError('Unsupported webhook.',400);
 const stamps=signature.split(',').filter(v=>v.startsWith('t=')),timestamp=Number(stamps[0]?.slice(2))*1000;
 if(!env.DB)throw new FamilyError('Subscription verification is unavailable.',503);
 const time=await env.DB.prepare(`SELECT ${clock} AS now`).first<{now:number}>();if(stamps.length!==1||!Number.isSafeInteger(timestamp)||!time||timestamp<time.now-300000||timestamp>time.now+30000)throw new FamilyError('Webhook verification failed.',400);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(raw)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 return event.type.startsWith('checkout.session.')?receiveCheckoutEvent(event,hash):receiveSubscriptionEvent(event,hash,c);
}
