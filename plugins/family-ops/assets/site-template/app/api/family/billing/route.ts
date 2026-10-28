import {getChatGPTUser} from '../../../chatgpt-auth';
import {getFamilyBilling,refreshFamilyBilling} from '../../../../lib/family-billing';
import {boundedRequest} from '../../../../lib/bounded-request';
import {safeError} from '../../../../lib/family-store';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200,retryAfter?:number)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(retryAfter?{'Retry-After':String(retryAfter)}:{})}});
export async function GET(){try{const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to view subscription status.'},401);return respond(await getFamilyBilling(user.userId));}catch(error){const e=safeError(error);return respond({error:e.message},e.status,e.retryAfter);}}
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'Open subscription settings in Family Ops.'},403);
 const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to check subscription status.'},401);
 if(!request.headers.get('content-type')?.includes('application/json'))return respond({error:'Use JSON.'},415);
 const raw=await boundedRequest(request,8192);let body;try{body=JSON.parse(new TextDecoder().decode(raw));}catch{return respond({error:'Check the request format.'},400);}
 return respond(await refreshFamilyBilling(user.userId,body));
 }catch(error){const e=safeError(error);return respond({error:e.message},e.status,e.retryAfter);}}
