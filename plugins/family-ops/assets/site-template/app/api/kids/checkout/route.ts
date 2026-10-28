import {KidsError} from '../../../../lib/kids';
import {requireKidsOwner} from '../../../../lib/kids-access';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getKidsCheckout,changeKidsCheckout} from '../../../../lib/kids-commerce';
import {requireCheckoutOrigin} from '../../../../lib/family-checkout';
import {boundedRequest} from '../../../../lib/bounded-request';
import {safeError} from '../../../../lib/family-store';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200,retryAfter?:number)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(retryAfter?{'Retry-After':String(retryAfter)}:{})}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to view your Kids subscription.'},401);requireKidsOwner(user.userId);const q=new URL(request.url).searchParams;return respond(await getKidsCheckout(user.userId,q.get('workspace')??'',q.get('intent')));}catch(error){const e=error instanceof KidsError?{message:error.message,status:error.status,retryAfter:undefined}:safeError(error);return respond({error:e.message},e.status,e.retryAfter);}}
export async function POST(request:Request){try{requireCheckoutOrigin(request);const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to manage your Kids subscription.'},401);requireKidsOwner(user.userId);if(!request.headers.get('content-type')?.includes('application/json'))return respond({error:'Use JSON.'},415);const raw=await boundedRequest(request,8192);let body;try{body=JSON.parse(new TextDecoder().decode(raw));}catch{return respond({error:'Check the request format.'},400);}return respond(await changeKidsCheckout(user.userId,body));}catch(error){const e=error instanceof KidsError?{message:error.message,status:error.status,retryAfter:undefined}:safeError(error);return respond({error:e.message},e.status,e.retryAfter);}}
