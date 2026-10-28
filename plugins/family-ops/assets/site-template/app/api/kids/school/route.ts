import {requireKidsOwner} from '../../../../lib/kids-access';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {kidsBody,kidsError} from '../../../../lib/kids-store';
import {stageSchoolCalendar,readSchoolCalendar,mutateSchoolCalendar} from '../../../../lib/kids-school-store';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return response({error:'Sign in to open your school calendars.'},401);requireKidsOwner(user.userId);return response(await readSchoolCalendar(user.userId,Object.fromEntries(new URL(request.url).searchParams)));}catch(e){const x=kidsError(e);return response({error:x.error},x.status);}}
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return response({error:'Make school calendar changes from Family Ops.'},403);const user=await getChatGPTUser();if(!user)return response({error:'Sign in before saving a school calendar.'},401);requireKidsOwner(user.userId);const raw=await kidsBody(request) as Record<string,unknown>;if(raw?.stageCalendar===true){const {stageCalendar,...input}=raw;void stageCalendar;return response(await stageSchoolCalendar(user.userId,input));}return response(await mutateSchoolCalendar(user.userId,raw));}catch(e){const x=kidsError(e);return response({error:x.error},x.status);}}
