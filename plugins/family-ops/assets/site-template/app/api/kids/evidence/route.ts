import {requireKidsOwner} from '../../../../lib/kids-access';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {kidsEvidencePage} from '../../../../lib/kids-records';
import {kidsError} from '../../../../lib/kids-store';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to read saved Kids messages.'},401);requireKidsOwner(user.userId);const q=new URL(request.url).searchParams;return respond(await kidsEvidencePage(user.userId,{workspaceId:q.get('workspace_id'),contextId:q.get('context_id'),...(q.has('cursor')?{cursor:q.get('cursor')}:{}),...(q.has('limit')?{limit:Number(q.get('limit'))}:{})}));}catch(error){const e=kidsError(error);return respond({error:e.error},e.status);}}
