import {env} from 'cloudflare:workers';
import {KidsError,type KidsContext} from './kids';

// Fixed Google row alias e. This is provider identity, never a text similarity test.
const match=`f.status='linked' AND f.provider_event_id<>'' AND f.owner_user_id=e.owner_user_id AND f.workspace_id=e.workspace_id AND f.link_id=e.link_id AND f.calendar_id=e.calendar_id AND f.provider_event_id=e.event_id`;
export const ownedGoogleOutputSql=`EXISTS(SELECT 1 FROM kids_google_effects f WHERE ${match})`;
export type GoogleBoardOutput={requestId:string;source:{kind:'context'|'google';id:string;title:string}|null;needsReview:boolean};
export const googleOutputExplanation='This is a Calendar copy from Family Board. Open the original board item to change the family plan.';

export async function googleBoardOutput(user:string,workspace:string,eventId:string,contexts:KidsContext[]):Promise<GoogleBoardOutput|null>{
 if(!env.DB)throw new KidsError('Calendar storage is unavailable.',503);
 const linked=await env.DB.prepare(`WITH matches AS (SELECT f.id,f.source_kind,f.source_id,f.created_revision FROM kids_google_events e JOIN kids_google_effects f ON ${match} WHERE e.owner_user_id=? AND e.workspace_id=? AND e.id=?) SELECT id,source_kind,source_id,(SELECT COUNT(*) FROM (SELECT source_kind,source_id FROM matches GROUP BY source_kind,source_id LIMIT 2)) origins FROM matches ORDER BY created_revision DESC,id DESC LIMIT 1`).bind(user,workspace,eventId).first<{id:string;source_kind:'context'|'google';source_id:string;origins:number}>();
 if(!linked)return null;
 let source:GoogleBoardOutput['source']=null;
 if(linked.origins===1){
  if(linked.source_kind==='context'){const c=contexts.find(c=>c.id===linked.source_id);if(c)source={kind:'context',id:c.id,title:c.title};}
  else{const origin=await env.DB.prepare('SELECT source_json,overrides_json FROM kids_google_events WHERE owner_user_id=? AND workspace_id=? AND id=?').bind(user,workspace,linked.source_id).first<{source_json:string;overrides_json:string}>();if(origin){const c=JSON.parse(origin.source_json).content,o=JSON.parse(origin.overrides_json);source={kind:'google',id:linked.source_id,title:typeof o.title==='string'?o.title:c?.english_title||'Saved event'};}}
 }
 return {requestId:linked.id,source,needsReview:!source};
}
