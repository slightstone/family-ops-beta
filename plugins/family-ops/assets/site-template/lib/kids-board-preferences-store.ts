import {env} from 'cloudflare:workers';
import {boardPreferencesSchema,defaultBoardPreferences,type BoardPreferences} from './kids-board-preferences';
import {KidsError} from './kids';
const db=()=> (env as unknown as {DB:D1Database}).DB;
export async function readBoardPreferences(user:string,workspace:string):Promise<BoardPreferences>{
 const row=await db().prepare('SELECT value FROM kids_board_preferences WHERE owner_user_id=? AND workspace_id=?').bind(user,workspace).first<{value:string}>();
 return row?boardPreferencesSchema.parse(JSON.parse(row.value)):defaultBoardPreferences();
}
export function boardPreferenceStatement(user:string,workspace:string,nonce:string,operation:string,p:BoardPreferences){
 return db().prepare(`INSERT INTO kids_board_preferences(owner_user_id,workspace_id,value,last_parent_operation_id) SELECT user_id,id,?,? FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=? ON CONFLICT(owner_user_id,workspace_id) DO UPDATE SET value=excluded.value,last_parent_operation_id=excluded.last_parent_operation_id`).bind(JSON.stringify(p),operation,user,workspace,nonce);
}
export async function boardPreferenceResult(user:string,workspace:string,operation:string){
 const row=await db().prepare('SELECT source_authority,committed_revision FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,workspace,operation).first<{source_authority:string|null;committed_revision:number}>();
 try{const r=JSON.parse(row?.source_authority??'null');if(r?.kind==='parent-board-preferences-v1'&&row)return {preferences:boardPreferencesSchema.parse(r.preferences),committedRevision:row.committed_revision};}catch{}
 throw new KidsError('This preference receipt is unavailable. Reopen the saved board.',409);
}
