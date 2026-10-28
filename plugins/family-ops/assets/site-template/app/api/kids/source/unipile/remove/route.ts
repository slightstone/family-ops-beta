import {requireKidsOwner} from '../../../../../../lib/kids-access';
import {getChatGPTUser} from '../../../../../chatgpt-auth';
import {savedRemovalStatus} from '@/lib/kids-hosted-removal';
import {kidsError} from '@/lib/kids-store';
export const dynamic='force-dynamic';
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return response({error:'Sign in to check connection removal.'},401);requireKidsOwner(user.userId);return response(await savedRemovalStatus(user.userId,new URL(request.url).searchParams.get('workspaceId')??''));}catch(error){const e=kidsError(error);return response({error:e.error},e.status);}}
export async function POST(){return response({error:'Use the reviewed WhatsApp source proposal and exact saved-operation recovery.'},403);}
