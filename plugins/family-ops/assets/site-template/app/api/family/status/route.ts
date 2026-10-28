import {getChatGPTUser} from '../../../chatgpt-auth';
import {getFamilyConnectionStatus} from '../../../../lib/family-store';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(){
  try{
    const user=await getChatGPTUser();
    if(!user)return respond({code:'SIGN_IN_REQUIRED',error:'Sign in to check your connection.',checkedAt:new Date().toISOString()},401);
    return respond(await getFamilyConnectionStatus(user.userId));
  }catch{return respond({code:'STORAGE_UNAVAILABLE',error:'The storage check is unavailable. No workspace data was changed.',checkedAt:new Date().toISOString()},503);}
}
