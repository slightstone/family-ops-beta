import {receiveStripeWebhook} from '../../../../lib/stripe-webhook';
import {safeError} from '../../../../lib/family-store';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 return Response.json(await receiveStripeWebhook(request),{headers:{'Cache-Control':'no-store'}});
 }catch(error){const e=safeError(error);return Response.json({error:e.message},{status:e.status,headers:{'Cache-Control':'no-store',...(e.retryAfter?{'Retry-After':String(e.retryAfter)}:{})}});}}
