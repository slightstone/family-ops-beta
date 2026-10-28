import {requireKidsOwner} from '../../../../../../lib/kids-access';
import {getChatGPTUser} from '../../../../../chatgpt-auth';
import {kidsBody,kidsError} from '../../../../../../lib/kids-store';
import {discoverKidsHostedChats} from '../../../../../../lib/kids-hosted-chats';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return response({error:'Find chats from Family Ops.'},403);const user=await getChatGPTUser();if(!user)return response({error:'Sign in before finding WhatsApp chats.'},401);requireKidsOwner(user.userId);return response(await discoverKidsHostedChats(user.userId,await kidsBody(request)));}catch(e){const x=kidsError(e);return response({error:x.error},x.status);}}
