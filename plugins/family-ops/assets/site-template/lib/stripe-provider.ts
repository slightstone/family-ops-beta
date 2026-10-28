import Stripe from 'stripe';
import {env} from 'cloudflare:workers';
import {ownedInstallation} from './owned-installation';
export const stripeApiVersion='2026-09-30.endive' as const;
export const billingNowSql="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export function stripeConfiguration(){
 if(ownedInstallation().kind!=='shared')return null;
 const mode=env.FAMILY_OPS_BILLING;
 if((mode!=='test'&&mode!=='live')||!new RegExp(`^sk_${mode}_[A-Za-z0-9]{16,256}$`).test(env.STRIPE_SECRET_KEY??'')||!/^whsec_[A-Za-z0-9]{16,256}$/.test(env.STRIPE_WEBHOOK_SECRET??'')||!/^price_[A-Za-z0-9]+$/.test(env.FAMILY_OPS_STRIPE_PRICE_ID??''))return null;
 return {mode,secret:env.STRIPE_SECRET_KEY!,webhook:env.STRIPE_WEBHOOK_SECRET!,price:env.FAMILY_OPS_STRIPE_PRICE_ID!};
}
export type StripeConfiguration=NonNullable<ReturnType<typeof stripeConfiguration>>;
export function stripeClient(c:StripeConfiguration){return new Stripe(c.secret,{apiVersion:stripeApiVersion,httpClient:Stripe.createFetchHttpClient(),timeout:8000,maxNetworkRetries:0,telemetry:false});}
