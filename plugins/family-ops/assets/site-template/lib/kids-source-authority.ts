// Trusted raw-provider versus application identity. No environment, provider or writes.
export type SourceIdentity={chatId:string;providerChatId?:string;connectionEpoch?:number};
export const providerChat=(a:SourceIdentity)=>a.providerChatId??a.chatId;
export const connectionEpoch=(a:SourceIdentity)=>a.connectionEpoch??0;
export function completeSourceIdentity(a:SourceIdentity){
 return a.providerChatId===undefined&&a.connectionEpoch===undefined||typeof a.providerChatId==='string'&&a.providerChatId.length>0&&Number.isSafeInteger(a.connectionEpoch)&&a.connectionEpoch! >=0;
}

/** Existing source records always use app IDs; raw heads never supply that identity. */
export function savedSourceChatSql(binding:string,rawChat:string,source:string){
 return `(EXISTS(SELECT 1 FROM kids_chat_sources identity_chat WHERE identity_chat.owner_user_id=${source}.owner_user_id AND identity_chat.workspace_id=${source}.workspace_id AND identity_chat.binding_id=${binding} AND identity_chat.provider_chat_id=${rawChat} AND identity_chat.app_chat_id=${source}.chat_id)
 OR (${source}.chat_id=${rawChat} AND NOT EXISTS(SELECT 1 FROM kids_source_connections identity_connection WHERE identity_connection.owner_user_id=${source}.owner_user_id AND identity_connection.workspace_id=${source}.workspace_id)))`;
}

export function batchAppIdentitySql(b:string){
 return `(EXISTS(SELECT 1 FROM kids_chat_sources identity_chat WHERE identity_chat.owner_user_id=${b}.owner_user_id AND identity_chat.workspace_id=${b}.workspace_id AND identity_chat.binding_id=${b}.binding_id AND identity_chat.provider_chat_id=${b}.chat_id AND identity_chat.app_chat_id=COALESCE(${b}.app_chat_id,${b}.chat_id))
 OR (COALESCE(${b}.app_chat_id,${b}.chat_id)=${b}.chat_id AND ${b}.connection_epoch=0 AND NOT EXISTS(SELECT 1 FROM kids_source_connections identity_connection WHERE identity_connection.owner_user_id=${b}.owner_user_id AND identity_connection.workspace_id=${b}.workspace_id)))`;
}

/** Receipt optional fields are a pair. Missing a required app ID is never guessed. */
export function receiptSourceIdentitySql(authority:string,b:string){
 const value=(name:string)=>`json_extract(${authority},'$.${name}')`,type=(name:string)=>`json_type(${authority},'$.${name}')`;
 return `(${type('chatId')}='text' AND ${value('chatId')}=COALESCE(${b}.app_chat_id,${b}.chat_id)
 AND ((${type('providerChatId')} IS NULL AND ${type('connectionEpoch')} IS NULL AND ${value('chatId')}=${b}.chat_id AND ${b}.connection_epoch=0
   AND (NOT EXISTS(SELECT 1 FROM kids_source_connections identity_connection WHERE identity_connection.owner_user_id=${b}.owner_user_id AND identity_connection.workspace_id=${b}.workspace_id)
    OR EXISTS(SELECT 1 FROM kids_chat_sources identity_chat WHERE identity_chat.owner_user_id=${b}.owner_user_id AND identity_chat.workspace_id=${b}.workspace_id AND identity_chat.binding_id=${b}.binding_id AND identity_chat.provider_chat_id=${b}.chat_id AND identity_chat.app_chat_id=${value('chatId')} AND identity_chat.identity_kind='legacy')))
  OR (${type('providerChatId')}='text' AND ${value('providerChatId')}=${b}.chat_id AND ${type('connectionEpoch')}='integer' AND ${value('connectionEpoch')}=${b}.connection_epoch AND ${value('connectionEpoch')}>=0)) AND ${batchAppIdentitySql(b)})`;
}

/** Repeated at release and inside the serialized board/source transaction. */
export function connectionSourceFence(binding:string,app:string,raw:string,epoch:number){
 return {sql:`(EXISTS(SELECT 1 FROM kids_source_connections connection JOIN kids_chat_sources mapping ON mapping.owner_user_id=connection.owner_user_id AND mapping.workspace_id=connection.workspace_id AND mapping.binding_id=connection.binding_id
 WHERE connection.owner_user_id=kids_state.user_id AND connection.workspace_id=kids_state.id AND connection.id=? AND connection.binding_id=? AND connection.status='connected'
 AND connection.source_epoch=? AND connection.discovery_consent=1 AND connection.processing_consent=1 AND connection.confirmed_at IS NOT NULL AND connection.paused=0 AND mapping.app_chat_id=? AND mapping.provider_chat_id=?)
 OR (?=? AND ?=0 AND NOT EXISTS(SELECT 1 FROM kids_source_connections connection WHERE connection.owner_user_id=kids_state.user_id AND connection.workspace_id=kids_state.id)
 AND json_extract(kids_state.document,'$.connection.accountId')=? AND json_extract(kids_state.document,'$.connection.selfUserId')=?
 AND (SELECT COUNT(*) FROM kids_hosted_bindings singleton WHERE singleton.owner_user_id=kids_state.user_id AND singleton.workspace_id=kids_state.id AND singleton.removed_at IS NULL)=1))`,values:[binding,binding,epoch,app,raw,app,raw,epoch,'hosted:'+binding,'hosted-self:'+binding]};
}
