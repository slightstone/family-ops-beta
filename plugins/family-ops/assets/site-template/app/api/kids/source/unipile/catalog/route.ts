import {requireKidsOwner} from '../../../../../../lib/kids-access';
import {getChatGPTUser} from '../../../../../chatgpt-auth';
import {kidsError} from '../../../../../../lib/kids-store';
import {getKidsChatCatalog} from '../../../../../../lib/kids-chat-catalog-state';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in before reviewing chat titles.'},{status:401});requireKidsOwner(user.userId);
 const q=Object.fromEntries(new URL(request.url).searchParams);const input={...q,...(q.limit?{limit:Number(q.limit)}:{})};
 return Response.json(await getKidsChatCatalog(user.userId,input),{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
 }catch(error){const e=kidsError(error);return Response.json({error:e.error},{status:e.status,headers:{'Cache-Control':'no-store'}});}}
