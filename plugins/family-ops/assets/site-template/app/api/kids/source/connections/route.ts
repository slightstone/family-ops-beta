import {requireKidsOwner} from '../../../../../lib/kids-access';
import {getChatGPTUser} from '../../../../chatgpt-auth';
import {kidsError} from '../../../../../lib/kids-store';
import {getKidsSourceConnections} from '../../../../../lib/kids-source-connections';
export const dynamic='force-dynamic';
const respond=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to view your WhatsApp connections.'},401);requireKidsOwner(user.userId);return respond(await getKidsSourceConnections(user.userId,new URL(request.url).searchParams.get('workspace_id')??''));}catch(error){const e=kidsError(error);return respond({error:e.error},e.status);}}
export async function POST(){return respond({error:'Use the reviewed WhatsApp source proposal and exact saved-operation recovery.'},403);}
