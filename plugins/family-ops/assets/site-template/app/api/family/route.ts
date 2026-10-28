import { getChatGPTUser } from '../../chatgpt-auth';
import {getFamily,createFamily,mutateFamily,deleteFamily,familyExport,safeError} from '../../../lib/family-store';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200,retryAfter?:number)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(retryAfter?{'Retry-After':String(retryAfter)}:{})}});
export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return respond({error:'Sign in to open your workspace.'},401);return respond(new URL(request.url).searchParams.has('export')?await familyExport(user.userId):await getFamily(user.userId));}catch(e){const x=safeError(e);return respond({error:x.message},x.status);}}
export async function POST(request:Request){try{
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return respond({error:'This change must come from Family Ops.'},403);
  const user=await getChatGPTUser();if(!user)return respond({error:'Sign in before saving.'},401);
  if(!request.headers.get('content-type')?.includes('application/json'))return respond({error:'Use JSON.'},415);
  if(Number(request.headers.get('content-length')??0)>1024*1024)return respond({error:'This workspace is too large to import.'},413);
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>1024*1024)return respond({error:'This workspace is too large to import.'},413);
  let body;try{body=JSON.parse(text);}catch{return respond({error:'Check the import format.'},400);}
  return respond(body?.deleteWorkspace===true?await deleteFamily(user.userId,body):body?.onboard===true?await createFamily(user.userId,body.data):await mutateFamily(user.userId,body));
}catch(e){const x=safeError(e);return respond({error:x.message},x.status,x.retryAfter);}}
