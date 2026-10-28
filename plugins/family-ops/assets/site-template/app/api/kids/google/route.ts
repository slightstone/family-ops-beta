import {requireKidsOwner} from '../../../../lib/kids-access';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {kidsBody,kidsError} from '../../../../lib/kids-store';
import {googleParse,googleReadSchema} from '../../../../lib/kids-google';
import {readGoogleCalendar,mutateGoogleCalendar,googlePrunePreview} from '../../../../lib/kids-google-store';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return response({error:'Sign in to open saved calendars.'},401);requireKidsOwner(user.userId);const q=Object.fromEntries(new URL(request.url).searchParams);if(q.prune==='preview'&&Object.keys(q).every(k=>k==='prune'||k==='workspace_id')){const a=googleParse(googleReadSchema,{workspace_id:q.workspace_id});return response(await googlePrunePreview(user.userId,a.workspace_id));}return response(await readGoogleCalendar(user.userId,q));}catch(e){const x=kidsError(e);return response({error:x.error},x.status);}}
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return response({error:'Confirm Calendar changes from Family Ops.'},403);const user=await getChatGPTUser();if(!user)return response({error:'Sign in before changing a calendar.'},401);requireKidsOwner(user.userId);return response(await mutateGoogleCalendar(user.userId,await kidsBody(request)));}catch(e){const x=kidsError(e);return response({error:x.error},x.status);}}
