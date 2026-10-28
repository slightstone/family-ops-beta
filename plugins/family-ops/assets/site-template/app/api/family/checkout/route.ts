import {getChatGPTUser} from '../../../chatgpt-auth';
import {getFamilyCheckout,changeFamilyCheckout,requireCheckoutOrigin} from '../../../../lib/family-checkout';
import {boundedRequest} from '../../../../lib/bounded-request';
import {safeError} from '../../../../lib/family-store';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200,retryAfter?:number)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(retryAfter?{'Retry-After':String(retryAfter)}:{})}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to view your subscription.'},401);return respond(await getFamilyCheckout(user.userId,new URL(request.url).searchParams.get('intent')));}catch(error){const e=safeError(error);return respond({error:e.message},e.status,e.retryAfter);}}
export async function POST(request:Request){try{requireCheckoutOrigin(request);const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to manage your subscription.'},401);if(!request.headers.get('content-type')?.includes('application/json'))return respond({error:'Use JSON.'},415);
 const raw=await boundedRequest(request,8192);let body;try{body=JSON.parse(new TextDecoder().decode(raw));}catch{return respond({error:'Check the request format.'},400);}return respond(await changeFamilyCheckout(user.userId,body));
 }catch(error){const e=safeError(error);return respond({error:e.message},e.status,e.retryAfter);}}
