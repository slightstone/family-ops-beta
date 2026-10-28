import {requireKidsOwner} from '../../../../lib/kids-access';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {kidsBody,kidsError} from '../../../../lib/kids-store';
import {getGoogleEffects,mutateGoogleEffect} from '../../../../lib/kids-google-effect-store';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return response({error:'Sign in to open saved Calendar requests.'},401);requireKidsOwner(user.userId);return response(await getGoogleEffects(user.userId,Object.fromEntries(new URL(request.url).searchParams)));}catch(e){const x=kidsError(e);return response({error:x.error},x.status);}}
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return response({error:'Review Calendar requests from Family Ops.'},403);const user=await getChatGPTUser();if(!user)return response({error:'Sign in before reviewing Calendar requests.'},401);requireKidsOwner(user.userId);return response(await mutateGoogleEffect(user.userId,await kidsBody(request)));}catch(e){const x=kidsError(e);return response({error:x.error},x.status);}}
