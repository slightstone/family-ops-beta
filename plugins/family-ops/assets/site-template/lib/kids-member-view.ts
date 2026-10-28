import {env} from 'cloudflare:workers';
import {checkedKids,KidsError} from './kids';
import {readParentBoard} from './kids-parent-store';
import {readBoardPreferences} from './kids-board-preferences-store';
import {recheckKidsAccess,type KidsAccess} from './kids-access';
export async function kidsMemberView(a:KidsAccess){
 const row=await env.DB!.prepare('SELECT document,revision,updated_at FROM kids_state WHERE user_id=? AND id=?').bind(a.ownerId,a.workspaceId).first<{document:string;revision:number;updated_at:string}>();if(!row)throw new KidsError('Shared organizer is unavailable.',403);
 const k=checkedKids(JSON.parse(row.document));
 const linked=new Set((await env.DB!.prepare('SELECT DISTINCT context_id FROM kids_source_links WHERE owner_user_id=? AND workspace_id=?').bind(a.ownerId,a.workspaceId).all<{context_id:string}>()).results.map(r=>r.context_id));
 const contexts=k.contexts.filter(c=>c.parentEntry&&!c.sourceIds.length&&!linked.has(c.id)).map(c=>({id:c.id,title:c.title,kind:c.kind,workflow:c.workflow,childIds:c.childIds,date:c.date,...(c.event?{event:c.event}:{}),notes:c.notes,parentEntry:{category:c.parentEntry!.category,createdAt:c.parentEntry!.createdAt,acknowledgedAt:c.parentEntry!.acknowledgedAt,archivedAt:c.parentEntry!.archivedAt},tasks:c.tasks.filter(t=>!t.sourceIds.length).map(t=>({id:t.id,title:t.title,childId:t.childId,due:t.due,resolution:t.resolution,acknowledgedAt:t.acknowledgedAt}))}));
 const parentActivities=await readParentBoard(a.ownerId,a.workspaceId),boardPreferences=await readBoardPreferences(a.ownerId,a.workspaceId);
 const current=await env.DB!.prepare('SELECT revision FROM kids_state WHERE user_id=? AND id=?').bind(a.ownerId,a.workspaceId).first<{revision:number}>();if(current?.revision!==row.revision)throw new KidsError('The shared organizer changed while reading. Reopen its saved version.',409);
 await recheckKidsAccess(a);
 return {kind:'shared-organizer' as const,workspaceId:a.workspaceId,revision:row.revision,updatedAt:row.updated_at,access:{role:a.role as 'viewer'|'editor',grantId:a.grantId,grantRevision:a.grantRevision},people:k.children.map(c=>({id:c.id,name:c.name})),contexts,parentActivities,boardPreferences,coverage:'Shared manual organizer. Optional source settings and source records stay private.'};
}
export type KidsMemberBoard=Awaited<ReturnType<typeof kidsMemberView>>;
