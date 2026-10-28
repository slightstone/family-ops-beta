import {getChatGPTUser} from '../../../chatgpt-auth';
import {changeAccess,getAccessState,previewInvitation} from '../../../../lib/family-sharing';
import {safeError} from '../../../../lib/family-store';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200,retryAfter?:number)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(retryAfter?{'Retry-After':String(retryAfter)}:{})}});
export async function GET(){try{const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to open access settings.'},401);return respond(await getAccessState(user.userId));}catch(error){const e=safeError(error);return respond({error:e.message},e.status);}}
export async function POST(request:Request){try{
 const origin=request.headers.get('origin');if(origin!==new URL(request.url).origin)return respond({error:'Open access settings in Family Ops.'},403);
 const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to manage access.'},401);
 if(!request.headers.get('content-type')?.includes('application/json'))return respond({error:'Use JSON.'},415);
 if(Number(request.headers.get('content-length')??0)>16384)return respond({error:'This access request is too large.'},413);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>16384)return respond({error:'This access request is too large.'},413);
 let body;try{body=JSON.parse(raw);}catch{return respond({error:'Check the request format.'},400);}
 return respond(body?.action==='preview'?await previewInvitation(user.email,body):await changeAccess(user,body));
 }catch(error){const e=safeError(error);return respond({error:e.message},e.status,e.retryAfter);}}
