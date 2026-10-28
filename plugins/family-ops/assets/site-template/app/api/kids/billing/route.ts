import {KidsError} from '../../../../lib/kids';
import {requireKidsOwner} from '../../../../lib/kids-access';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {refreshKidsBilling} from '../../../../lib/kids-commerce';
import {requireCheckoutOrigin} from '../../../../lib/family-checkout';
import {boundedRequest} from '../../../../lib/bounded-request';
import {safeError} from '../../../../lib/family-store';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{requireCheckoutOrigin(request);const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in to manage your Kids subscription.'},{status:401});requireKidsOwner(user.userId);if(!request.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Use JSON.'},{status:415});const raw=await boundedRequest(request,8192);let body;try{body=JSON.parse(new TextDecoder().decode(raw));}catch{return Response.json({error:'Check the request format.'},{status:400});}return Response.json(await refreshKidsBilling(user.userId,body),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch(error){const e=error instanceof KidsError?{message:error.message,status:error.status,retryAfter:undefined}:safeError(error);return Response.json({error:e.message},{status:e.status,headers:{'Cache-Control':'no-store',...(e.retryAfter?{'Retry-After':String(e.retryAfter)}:{})}});}}
