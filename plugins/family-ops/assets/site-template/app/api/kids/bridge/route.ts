import {requireKidsOwner} from '../../../../lib/kids-access';
import {getKidsBridge,postKidsBridge,kidsBody,kidsError} from '../../../../lib/kids-store';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(request:Request){try{const actor=request.headers.get('oai-authenticated-user-id');if(actor)requireKidsOwner(actor);return respond(await getKidsBridge(request));}catch(e){const x=kidsError(e);return respond({error:x.error},x.status);}}
export async function POST(request:Request){try{const actor=request.headers.get('oai-authenticated-user-id');if(actor)requireKidsOwner(actor);return respond(await postKidsBridge(request,await kidsBody(request)));}catch(e){const x=kidsError(e);return respond({error:x.error},x.status);}}
