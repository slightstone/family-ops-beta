import {KidsError} from '../../../../../../lib/kids';
import {receiveKidsHostedEvent} from '../../../../../../lib/kids-hosted-intake';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 try{return Response.json(await receiveKidsHostedEvent(request),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
 catch(e){return Response.json({error:e instanceof KidsError?e.message:'Source intake could not be confirmed. Retry the same event; reconciliation is required.'},{status:e instanceof KidsError?e.status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
}
