import {requireKidsOwner} from '../../../../../../lib/kids-access';
import {getChatGPTUser} from '../../../../../chatgpt-auth';
import {kidsError} from '../../../../../../lib/kids-store';
import {kidsHostedAuthStatus} from '../../../../../../lib/kids-hosted-auth';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export async function GET(){try{const user=await getChatGPTUser();if(!user)return response({error:'Sign in to check your WhatsApp setup.'},401);requireKidsOwner(user.userId);return response(await kidsHostedAuthStatus(user.userId));}catch(e){const x=kidsError(e);return response({error:x.error},x.status);}}
export async function POST(){return response({error:'Use the reviewed WhatsApp source proposal and exact saved-operation recovery.'},403);}
