import {requireKidsOwner} from '../../../../../../lib/kids-access';
import {getChatGPTUser,chatGPTSignInPath} from '../../../../../chatgpt-auth';
import {finishKidsHostedAuth} from '../../../../../../lib/kids-hosted-auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.redirect(new URL(chatGPTSignInPath('/kids'),request.url),303);try{requireKidsOwner(user.userId);}catch{return new Response('Only the owner can finish source setup.',{status:403,headers:{'Cache-Control':'no-store'}});}
 let outcome='unconfirmed';try{const r=await finishKidsHostedAuth(user.userId,new URL(request.url));outcome=r.status==='connected'?'verified':'pending';}catch{/* Details remain in owned setup status; do not reflect provider inputs. */}
 return new Response(null,{status:303,headers:{Location:'/kids?sourceSetup='+outcome,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
