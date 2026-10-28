import {connectionRemovalGuard} from './kids-hosted-removal-state';
import {z} from 'zod/v4';
import {KidsError,type Kids} from './kids';
import {catalogDb,catalogBinding,catalogConnectionFence,catalogCanDiscover,catalogSourceMaps,readChatScan,kidsRelevanceProfileHash,type CatalogRow} from './kids-chat-catalog-state';
import {kidsHostedSettings} from './kids-hosted-api';
import {type KidsChatSource} from './kids-source-connections';
import {KIDS_HOSTED_CONSENT} from './kids-hosted-config';

const hash=z.string().regex(/^[a-f0-9]{64}$/),identity={id:z.string().min(1).max(180),metadataHash:hash,childId:z.string().max(180)};
const scope={bindingId:z.string().uuid(),scanRevision:z.number().int().min(1),generation:z.number().int().min(1),profileHash:hash};
export const recommendChatsInput=z.object({...scope,entries:z.array(z.object({...identity,reason:z.string().trim().min(1).max(300),confidence:z.enum(['strong','possible'])}).strict()).min(1).max(100)}).strict();
export const addChatTitlesInput=z.object({...scope,entries:z.array(z.object(identity).strict()).min(1).max(30)}).strict();
export type CatalogFence={sql:string;values:(string|number|null)[];mappings?:KidsChatSource[]};

// Saved metadata only. The parent still supplies the sole source-activation step.
export async function prepareKidsCatalogChoices(user:string,k:Kids,epoch:number,input:unknown,kind:'recommendChats'|'addChatTitles'){
 const parsed=(kind==='recommendChats'?recommendChatsInput:addChatTitlesInput).safeParse(input);
 if(!parsed.success)throw new KidsError('Check the current saved-title references and family interview.');const e=parsed.data;
 if(k.mode!=='live'||!k.discoveryConsent)throw new KidsError('Confirm chat-title discovery before reviewing these titles.',403);
 if(e.profileHash!==await kidsRelevanceProfileHash(k))throw new KidsError('Your interview changed. Review these chat titles against the current family details.',409);
 const binding=await catalogBinding(user,k.id,k,e.bindingId);catalogCanDiscover(binding);const scan=await readChatScan(binding.id),config=await kidsHostedSettings();
 if(!scan||scan.revision!==e.scanRevision||scan.generation!==e.generation||scan.epoch!==epoch||scan.binding_revision!==binding.revision||scan.config_hash!==config.fingerprint||!binding.active||binding.removed_at!==null||binding.consent_version!==KIDS_HOSTED_CONSENT||binding.application_id!==config.UNIPILE_APPLICATION_ID||binding.production!==Number(config.UNIPILE_ENVIRONMENT==='production')||binding.endpoint_id!==config.channelId||!/^[a-f0-9]{64}$/.test(binding.provider_identity_hash))throw new KidsError('Your title scan or connection changed. Reopen the current titles before saving suggestions.',409);
 if(new Set(e.entries.map(v=>v.id)).size!==e.entries.length)throw new KidsError('Use each saved title only once.');
 const rows=(await catalogDb().prepare("SELECT * FROM kids_chat_catalog WHERE binding_id=? AND metadata_hash IN (SELECT json_extract(value,'$.metadataHash') FROM json_each(?))").bind(binding.id,JSON.stringify(e.entries)).all<CatalogRow>()).results;
 const mapped=await catalogSourceMaps(user,k.id,binding,rows);
 for(const item of e.entries){const row=rows.find(v=>v.metadata_hash===item.metadataHash&&mapped.ids.get(v.chat_id)===item.id);if(!row||row.seen_generation!==scan.generation||row.metadata_hash!==item.metadataHash||!row.title||row.kind==='channel'||row.kind==='1to1'&&scan.scope!=='all')throw new KidsError('One title is stale or outside this confirmed scan. Reopen the title list; nothing was staged.',409);if(item.childId&&!k.children.some(c=>c.id===item.childId))throw new KidsError('Choose a child from this family interview.');}
 for(const m of mapped.missing)if(k.candidates.some(c=>c.id===m.app_chat_id||c.id===m.provider_chat_id&&c.accountId==='hosted:'+binding.id))throw new KidsError('A saved candidate is missing its immutable source map. Reconcile it before adding titles.',409);
 const additions=e.entries.filter(item=>!k.candidates.some(c=>c.id===item.id));
 if(k.candidates.length+additions.length>100)throw new KidsError('This board has room for100 reviewed chat choices. The full title catalog is kept; no suggestions were silently omitted.',413);
 if(kind==='addChatTitles'&&new Set([...k.grants.map(g=>g.chatId),...e.entries.map(v=>v.id),...k.candidates.filter(c=>c.reviewPending&&c.decision==='selected').map(c=>c.id)]).size>30)throw new KidsError('This board supports thirty saved tracking sources. Review existing sources before adding more.',413);
 for(const item of e.entries){const row=rows.find(v=>v.metadata_hash===item.metadataHash&&mapped.ids.get(v.chat_id)===item.id)!;let candidate=k.candidates.find(c=>c.id===item.id);
  if(candidate&&candidate.accountId!=='hosted:'+binding.id)throw new KidsError('This title has a different account identity. Reopen connection setup.',409);
  if(kind==='recommendChats'&&candidate&&candidate.decision!=='pending')continue;
  if(kind==='addChatTitles'&&k.grants.some(g=>g.chatId===item.id))throw new KidsError('This chat already has tracking settings. Manage it in Settings instead of adding it again.',409);
  if(!candidate){candidate={id:item.id,accountId:'hosted:'+binding.id,title:row.title,lastActivity:row.last_activity,childId:item.childId,topic:'kids',decision:'pending',reason:''};k.candidates.push(candidate);}
  candidate.title=row.title;candidate.lastActivity=row.last_activity;
  if(kind==='recommendChats'){
   const suggestion=item as z.infer<typeof recommendChatsInput>['entries'][number];candidate.childId=suggestion.childId;candidate.reason=suggestion.reason;candidate.recommendation={bindingId:binding.id,metadataHash:row.metadata_hash,profileHash:e.profileHash,generation:scan.generation,catalogRevision:scan.revision,childId:suggestion.childId,reason:suggestion.reason,confidence:suggestion.confidence};
  }else{candidate.childId=item.childId;candidate.decision='selected';candidate.reason='You added this chat by title. Review its people and scope before tracking.';candidate.reviewPending=true;}
 }
 if(!k.connection.accountId){k.connection.accountId='hosted:'+binding.id;k.connection.selfUserId='hosted-self:'+binding.id;}
 if(!k.confirmedAt&&k.step==='connect')k.step='chats';
 // The same scan revision also fences every metadata row; scan commits and row
 // upserts are one atomic transaction. No source grants/epoch/consent change.
 const removal=connectionRemovalGuard(binding.id),connection=catalogConnectionFence(binding.id,binding.connection);
 const sql="EXISTS(SELECT 1 FROM kids_chat_scans s JOIN kids_hosted_bindings b ON b.id=s.binding_id WHERE s.binding_id=? AND s.revision=? AND s.generation=? AND s.epoch=kids_state.epoch AND s.config_hash=? AND s.binding_revision=b.revision AND b.owner_user_id=kids_state.user_id AND b.workspace_id=kids_state.id AND b.revision=? AND b.active=1 AND b.removed_at IS NULL AND b.consent_version=? AND b.application_id=? AND b.production=? AND b.endpoint_id=? AND b.scope_id=? AND b.account_id=? AND b.provider_identity_hash=? AND json_extract(kids_state.document,'$.mode')='live' AND json_extract(kids_state.document,'$.discoveryConsent')=1)"+' AND '+connection.sql+' AND '+removal.sql;
 return {kids:k,fence:{sql,values:[binding.id,scan.revision,scan.generation,config.fingerprint,binding.revision,KIDS_HOSTED_CONSENT,binding.application_id,binding.production,binding.endpoint_id,binding.scope_id,binding.account_id,binding.provider_identity_hash,...connection.values,...removal.values],mappings:mapped.missing} satisfies CatalogFence};
}

export async function kidsRecommendationFreshness(user:string,k:Kids){
 const candidates=k.candidates.filter(c=>c.recommendation);if(!candidates.length)return {} as Record<string,boolean>;
 const profileHash=await kidsRelevanceProfileHash(k),rows=(await catalogDb().prepare("SELECT COALESCE(m.app_chat_id,c.chat_id) AS chat_id,c.binding_id,c.metadata_hash,c.seen_generation,s.generation FROM kids_chat_catalog c LEFT JOIN kids_chat_sources m ON m.binding_id=c.binding_id AND m.provider_chat_id=c.chat_id JOIN kids_chat_scans s ON s.binding_id=c.binding_id JOIN kids_hosted_bindings b ON b.id=c.binding_id WHERE b.owner_user_id=? AND b.workspace_id=? AND COALESCE(m.app_chat_id,c.chat_id) IN (SELECT json_extract(value,'$.id') FROM json_each(?))").bind(user,k.id,JSON.stringify(candidates)).all<{chat_id:string;binding_id:string;metadata_hash:string;seen_generation:number;generation:number}>()).results;
 return Object.fromEntries(candidates.map(c=>{const r=c.recommendation!,row=rows.find(v=>v.binding_id===r.bindingId&&v.chat_id===c.id);return [c.id,r.profileHash===profileHash&&!!row&&r.metadataHash===row.metadata_hash&&r.generation===row.seen_generation&&r.generation===row.generation];}));
}
