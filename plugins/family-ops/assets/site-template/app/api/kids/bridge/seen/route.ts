import {requireKidsOwner} from '../../../../../lib/kids-access';
import {readKidsSeen,kidsBody,kidsError} from '../../../../../lib/kids-store';
export const dynamic='force-dynamic';
export async function POST(request:Request){const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};try{const actor=request.headers.get('oai-authenticated-user-id');if(actor)requireKidsOwner(actor);return Response.json(await readKidsSeen(request,await kidsBody(request)),{headers});}catch(error){const e=kidsError(error);return Response.json({error:e.error},{status:e.status,headers});}}
