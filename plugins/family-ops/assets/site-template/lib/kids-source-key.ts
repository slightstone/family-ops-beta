import {KidsError} from './kids-error';

// Internal source identity, never a model or HTTP argument. Hosted callers
// provide a complete map allocated by the authenticated control plane.
export type KidsSourceKeys=ReadonlyMap<string,string>;
export const kidsSourceIdentityTuple=(chatId:string,messageId:string)=>JSON.stringify([chatId,messageId]);
export function kidsMessageSourceKey(chatId:string,messageId:string,keys?:KidsSourceKeys){
 if(!keys)return chatId+':'+messageId; // Existing single-account local bridge.
 const key=keys.get(kidsSourceIdentityTuple(chatId,messageId));
 if(!key||key.length>800)throw new KidsError('The saved source identity changed. Reopen this source batch; earlier work is kept.',409);
 return key;
}
