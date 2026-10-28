import {getChatGPTUser} from '../../../chatgpt-auth';
import {changeKidsFamily,kidsFamilyState,previewKidsInvitation} from '../../../../lib/kids-access';
import {kidsBody,kidsError} from '../../../../lib/kids-store';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function GET(){try{const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to manage family access.'},401);return respond(await kidsFamilyState(user.userId));}catch(e){const x=kidsError(e);return respond({error:x.error},x.status);}}
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'Review access from this Family Ops Site.'},403);const user=await getChatGPTUser();if(!user)return respond({error:'Sign in with the intended invited account.'},401);const body=await kidsBody(request);return respond((body as {action?:string})?.action==='preview'?await previewKidsInvitation(user,body):await changeKidsFamily(user,body));}catch(e){const x=kidsError(e);return respond({error:x.error},x.status);}}
