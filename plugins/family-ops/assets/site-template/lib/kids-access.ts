import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {KidsError,type Kids} from './kids';
import {ownedInstallation} from './owned-installation';
import {kidsHash} from './kids-hash';
const db=()=>env.DB!;
const now="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export type KidsAccess={actorId:string;ownerId:string;workspaceId:string;installationId:string;role:'owner'|'viewer'|'editor';grantId:string;grantRevision:number};
export function kidsSharingConfigured(){return (env as unknown as Record<string,string>).FAMILY_OPS_KIDS_SHARING==='enabled'&&ownedInstallation().kind==='owned';}
export function requireKidsOwner(user:string){const o=ownedInstallation();if(o.kind==='invalid-owned'||o.kind==='owned'&&o.ownerId!==user)throw new KidsError('Only this installation’s owner can use source, setup or administration controls.',403);}
const denied=()=>new KidsError('Shared organizer access is unavailable for this account. Your unsent draft has not been submitted.',403);
export async function resolveKidsAccess(actorId:string):Promise<KidsAccess|null>{
 const o=ownedInstallation();if(o.kind==='shared')return null;if(o.kind==='invalid-owned')throw denied();
 if(actorId===o.ownerId)return {actorId,ownerId:o.ownerId,workspaceId:'',installationId:o.installationId,role:'owner',grantId:o.installationId,grantRevision:1};
 if(!kidsSharingConfigured())throw denied();
 const m=await db().prepare("SELECT m.workspace_id,m.grant_id,m.revision,m.role FROM kids_family_members m JOIN kids_state k ON k.user_id=m.owner_user_id AND k.id=m.workspace_id JOIN kids_service_access s ON s.owner_user_id=k.user_id AND s.workspace_id=k.id WHERE m.installation_id=? AND m.owner_user_id=? AND m.member_user_id=? AND m.revoked_at IS NULL AND s.kind='owned' AND s.grant_id=? AND s.revoked_at IS NULL").bind(o.installationId,o.ownerId,actorId,o.installationId).first<{workspace_id:string;grant_id:string;revision:number;role:'viewer'|'editor'}>();
 if(!m)throw denied();return {actorId,ownerId:o.ownerId,workspaceId:m.workspace_id,installationId:o.installationId,role:m.role,grantId:m.grant_id,grantRevision:m.revision};
}
export function kidsMemberFence(a:KidsAccess){return {sql:"EXISTS(SELECT 1 FROM kids_family_members m JOIN kids_service_access s ON s.owner_user_id=m.owner_user_id AND s.workspace_id=m.workspace_id WHERE m.installation_id=? AND m.owner_user_id=kids_state.user_id AND m.workspace_id=kids_state.id AND m.member_user_id=? AND m.grant_id=? AND m.revision=? AND m.role='editor' AND m.revoked_at IS NULL AND s.kind='owned' AND s.grant_id=? AND s.revoked_at IS NULL)",values:[a.installationId,a.actorId,a.grantId,a.grantRevision,a.installationId]};}
export async function recheckKidsAccess(a:KidsAccess){const current=await resolveKidsAccess(a.actorId);if(!current||current.grantId!==a.grantId||current.grantRevision!==a.grantRevision||current.workspaceId!==a.workspaceId||current.role!==a.role)throw denied();}
export function assertKidsMemberBinding(a:KidsAccess,input:{workspaceId?:string;grantId?:string;grantRevision?:number}){if(a.role!=='editor'||input.workspaceId!==a.workspaceId||input.grantId!==a.grantId||input.grantRevision!==a.grantRevision)throw denied();}
export async function assertManualMemberCommand(a:KidsAccess,k:Kids,type:string,args:unknown){
 if(a.role!=='editor'||!args||typeof args!=='object'||Array.isArray(args))throw denied();const v=args as {command?:{action?:string};contextId?:string;taskId?:string;action?:string};
 if(type==='parentActivity'&&['add','edit','end','session'].includes(v.command?.action??''))return;
 if(type==='parentItem'&&v.command?.action==='create')return;
 const c=k.contexts.find(c=>c.id===(type==='parentItem'?(v.command as {contextId?:string})?.contextId:v.contextId));
 if(!c?.parentEntry||c.sourceIds.length||await db().prepare('SELECT 1 ok FROM kids_source_links WHERE owner_user_id=? AND workspace_id=? AND context_id=? LIMIT 1').bind(a.ownerId,k.id,c.id).first())throw denied();
 if(type==='parentItem'&&['edit','review'].includes(v.command?.action??''))return;
 if(type==='task'&&['acknowledge','done','reopen','dismiss'].includes(v.action??'')&&c.tasks.some(t=>t.id===v.taskId&&!t.sourceIds.length))return;
 throw denied();
}
export function kidsManualAudit(a:KidsAccess,operation:string,type:string,nonce:string){return db().prepare(`INSERT INTO kids_family_manual_audit(actor_id,operation_id,installation_id,owner_user_id,workspace_id,grant_id,grant_revision,action,board_revision,committed_at) SELECT ?,?,?,?,?,?,?,?,revision,${now} FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?`).bind(a.actorId,operation,a.installationId,a.ownerId,a.workspaceId,a.grantId,a.grantRevision,type,a.ownerId,a.workspaceId,nonce);}
const code=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid();
const base={operationId:uuid,workspaceId:uuid,confirmed:z.literal(true)};
const input=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('create'),email:z.string().trim().email().max(254),label:z.string().trim().min(1).max(80).refine(v=>!v.includes('@')),role:z.enum(['viewer','editor']).default('viewer')}).strict(),
 z.object({...base,action:z.literal('accept'),invitationId:uuid,code}).strict(),
 z.object({...base,action:z.literal('cancel'),invitationId:uuid}).strict(),
 z.object({...base,action:z.literal('revoke'),targetGrantId:uuid}).strict(),
 z.object({...base,action:z.literal('leave'),grantId:uuid,grantRevision:z.number().int().min(1)}).strict(),
]);
const keyReady=()=>/^[a-f0-9]{64}$/.test(env.FAMILY_OPS_INVITE_KEY_V1??'');
const hex=(x:ArrayBuffer|Uint8Array)=>Array.from(new Uint8Array(x)).map(x=>x.toString(16).padStart(2,'0')).join('');
async function recipient(email:string){if(!keyReady())throw new KidsError('Family invitations need the installation invitation key. Ask the owner to finish setup.',503);const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.FAMILY_OPS_INVITE_KEY_V1!.match(/../g)!,x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);return 'v1:'+hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(email.trim().toLowerCase())));}
const unavailable=()=>new KidsError('This invitation is unavailable for this account. Check the account or ask the owner.',404);
async function ownerBoard(){const o=ownedInstallation();if(!kidsSharingConfigured()||o.kind!=='owned')throw unavailable();const r=await db().prepare("SELECT k.id FROM kids_state k JOIN kids_service_access s ON s.owner_user_id=k.user_id AND s.workspace_id=k.id WHERE k.user_id=? AND s.kind='owned' AND s.grant_id=? AND s.revoked_at IS NULL").bind(o.ownerId,o.installationId).first<{id:string}>();if(!r)throw unavailable();return {o,workspace:r.id};}
type Invite={id:string;workspace_id:string;role:'viewer'|'editor';expires_at:number;accepted_at:number|null;cancelled_at:number|null;accepted_by:string|null};
async function invitation(email:string,raw:string){const {o,workspace}=await ownerBoard();const i=await db().prepare(`SELECT * FROM kids_family_invites WHERE installation_id=? AND owner_user_id=? AND workspace_id=? AND token_hash=? AND recipient_hash=? AND cancelled_at IS NULL AND expires_at>${now}`).bind(o.installationId,o.ownerId,workspace,await kidsHash(raw),await recipient(email)).first<Invite>();if(!i)throw unavailable();return {i,o,workspace};}
export async function previewKidsInvitation(user:{userId:string;email:string},value:unknown){const a=z.object({action:z.literal('preview'),code}).strict().parse(value),{i,o}=await invitation(user.email,a.code);if(i.accepted_at!==null||user.userId===o.ownerId)throw unavailable();return {invitationId:i.id,workspaceId:i.workspace_id,role:i.role,expiresAt:i.expires_at,household:'Family organizer',scope:'All people, parent-entered items, manual activities and shared completion. Source settings stay private. Site viewer access is separate.'};}
export async function kidsFamilyState(actor:string){
 const a=await resolveKidsAccess(actor);if(!a||!kidsSharingConfigured())return {enabled:false};if(a.role!=='owner')return {enabled:true,workspaceId:a.workspaceId,access:{role:a.role,grantId:a.grantId,grantRevision:a.grantRevision}};const {o,workspace}=await ownerBoard();
 const members=(await db().prepare('SELECT grant_id AS grantId,revision,label,hint,role,joined_at AS joinedAt FROM kids_family_members WHERE installation_id=? AND workspace_id=? AND revoked_at IS NULL ORDER BY joined_at,grant_id').bind(o.installationId,workspace).all()).results;
 const invitations=(await db().prepare(`SELECT id,label,hint,role,expires_at AS expiresAt FROM kids_family_invites WHERE installation_id=? AND workspace_id=? AND cancelled_at IS NULL AND accepted_at IS NULL AND expires_at>${now} ORDER BY created_at,id`).bind(o.installationId,workspace).all()).results;
 return {enabled:true,workspaceId:workspace,invitationKeyReady:keyReady(),members,invitations};
}
export async function changeKidsFamily(user:{userId:string;email:string},value:unknown){
 const a=input.parse(value);
 if(a.action==='leave'){const o=ownedInstallation();if(o.kind!=='owned'||!kidsSharingConfigured())throw denied();const old=await db().prepare("SELECT body_hash,result FROM kids_family_operations WHERE actor_id=? AND operation_id=? AND installation_id=? AND workspace_id=? AND kind='leave'").bind(user.userId,a.operationId,o.installationId,a.workspaceId).first<{body_hash:string;result:string}>();if(old){const hash=await kidsHash(JSON.stringify([o.installationId,user.userId,a]));if(old.body_hash!==hash||JSON.parse(old.result).grantId!==a.grantId)throw denied();return {action:'leave',left:true,retried:true};}}
 const {o,workspace}=await ownerBoard();if(a.workspaceId!==workspace)throw unavailable();const actorHash=a.action==='create'||a.action==='accept'?await recipient(user.email):'';let access:KidsAccess|null=null;
 if(a.action==='accept'){const found=await invitation(user.email,a.code);if(found.i.id!==a.invitationId||user.userId===o.ownerId)throw unavailable();if(found.i.accepted_at!==null){access=await resolveKidsAccess(user.userId);if(access?.role==='owner')throw unavailable();}}
 else{access=await resolveKidsAccess(user.userId);if(!access)throw denied();if(a.action==='leave'){if(access.role==='owner'||a.grantId!==access.grantId||a.grantRevision!==access.grantRevision)throw denied();}else if(access.role!=='owner')throw denied();}
 const fingerprint:Record<string,unknown>={...a};delete fingerprint.email;delete fingerprint.code;if(a.action==='create')fingerprint.recipientHash=await recipient(a.email);if(a.action==='accept')fingerprint.tokenHash=await kidsHash(a.code);
 const hash=await kidsHash(JSON.stringify([o.installationId,user.userId,fingerprint]));
 const prior=()=>db().prepare('SELECT body_hash,result,kind FROM kids_family_operations WHERE actor_id=? AND operation_id=?').bind(user.userId,a.operationId).first<{body_hash:string;result:string;kind:string}>();
 const result=async(r:{body_hash:string;result:string;kind:string},retried:boolean,rawCode?:string)=>{if(r.body_hash!==hash)throw new KidsError('This retry belongs to another access change.',409);return {...JSON.parse(r.result),retried,...(r.kind==='create'?{code:rawCode??null,delivery:rawCode?'ready':'Code unavailable after retry. Cancel this exact invitation and confirm a new one if needed.'}:{}),...(r.kind==='leave'?{left:true}:{accessState:await kidsFamilyState(user.userId)})};};
 const old=await prior();if(old){if(old.kind==='accept'&&access?.grantId!==JSON.parse(old.result).grantId)throw denied();return result(old,true);}
 const rawCode=a.action==='create'?hex(crypto.getRandomValues(new Uint8Array(32))):undefined,id=crypto.randomUUID(),grant=crypto.randomUUID(),created=Date.now();let condition='1',values:(string|number)[]=[],payload:Record<string,unknown>={action:a.action};
 const live=`installation_id=? AND workspace_id=? AND revoked_at IS NULL`;
 if(a.action==='create'){
  if(fingerprint.recipientHash===actorHash)throw new KidsError('The owner already has access. Invite another adult.');
  condition=`(SELECT COUNT(*) FROM kids_family_invites WHERE installation_id=? AND workspace_id=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>${now})<5 AND NOT EXISTS(SELECT 1 FROM kids_family_invites WHERE installation_id=? AND workspace_id=? AND recipient_hash=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>${now}) AND NOT EXISTS(SELECT 1 FROM kids_family_members WHERE ${live} AND recipient_hash=?)`;
  values=[o.installationId,workspace,o.installationId,workspace,String(fingerprint.recipientHash),o.installationId,workspace,String(fingerprint.recipientHash)];payload={action:a.action,invitationId:id,expiresAt:created+7*86400000,role:a.role};
 }else if(a.action==='accept'){
  condition=`(SELECT COUNT(*) FROM kids_family_members WHERE ${live})<4 AND NOT EXISTS(SELECT 1 FROM kids_family_members WHERE ${live} AND (member_user_id=? OR recipient_hash=?)) AND EXISTS(SELECT 1 FROM kids_family_invites WHERE id=? AND installation_id=? AND workspace_id=? AND token_hash=? AND recipient_hash=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>${now})`;
  values=[o.installationId,workspace,o.installationId,workspace,user.userId,actorHash,a.invitationId,o.installationId,workspace,String(fingerprint.tokenHash),actorHash];payload={action:a.action,invitationId:a.invitationId,grantId:grant};
 }else if(a.action==='cancel'){condition=`EXISTS(SELECT 1 FROM kids_family_invites WHERE id=? AND installation_id=? AND workspace_id=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>${now})`;values=[a.invitationId,o.installationId,workspace];payload={action:a.action,invitationId:a.invitationId};}
 else{const target=a.action==='leave'?a.grantId:a.targetGrantId;condition=`EXISTS(SELECT 1 FROM kids_family_members WHERE grant_id=? AND ${live}${a.action==='leave'?' AND member_user_id=? AND revision=?':''})`;values=[target,o.installationId,workspace,...(a.action==='leave'?[user.userId,a.grantRevision]:[])];payload={action:a.action,grantId:target};}
 const nonce=crypto.randomUUID(),gate=`EXISTS(SELECT 1 FROM kids_family_operations WHERE actor_id=? AND operation_id=? AND nonce=?)`,tail=[user.userId,a.operationId,nonce];
 const statements=[db().prepare(`INSERT INTO kids_family_operations(actor_id,operation_id,installation_id,owner_user_id,workspace_id,kind,body_hash,result,nonce,committed_at) SELECT ?,?,?,?,?,?,?,?,?,${now} WHERE (${condition}) AND EXISTS(SELECT 1 FROM kids_service_access s WHERE s.owner_user_id=? AND s.workspace_id=? AND s.kind='owned' AND s.grant_id=? AND s.revoked_at IS NULL) AND (SELECT COUNT(*) FROM kids_family_operations WHERE actor_id=? AND committed_at>${now}-60000)<20 AND NOT EXISTS(SELECT 1 FROM kids_family_operations WHERE actor_id=? AND operation_id=?) RETURNING operation_id`).bind(user.userId,a.operationId,o.installationId,o.ownerId,workspace,a.action,hash,JSON.stringify(payload),nonce,...values,o.ownerId,workspace,o.installationId,user.userId,user.userId,a.operationId)];
 if(a.action==='create'){const e=a.email.trim().toLowerCase(),hint=e[0]+'•••@'+e.split('@')[1][0]+'•••';statements.push(db().prepare(`INSERT INTO kids_family_invites SELECT ?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL WHERE ${gate}`).bind(id,o.installationId,o.ownerId,workspace,await kidsHash(rawCode!),String(fingerprint.recipientHash),a.label,hint,a.role,created+7*86400000,created,...tail));}
 else if(a.action==='accept'){
  statements.push(db().prepare(`INSERT INTO kids_family_members(grant_id,installation_id,owner_user_id,workspace_id,member_user_id,recipient_hash,invitation_id,label,hint,role,revision,joined_at,revoked_at) SELECT ?,installation_id,owner_user_id,workspace_id,?,recipient_hash,id,label,hint,role,1,${now},NULL FROM kids_family_invites WHERE id=? AND ${gate}`).bind(grant,user.userId,a.invitationId,...tail));
  statements.push(db().prepare(`UPDATE kids_family_invites SET accepted_at=${now},accepted_by=? WHERE id=? AND ${gate}`).bind(user.userId,a.invitationId,...tail));
 }else if(a.action==='cancel')statements.push(db().prepare(`UPDATE kids_family_invites SET cancelled_at=${now} WHERE id=? AND ${gate}`).bind(a.invitationId,...tail));
 else statements.push(db().prepare(`UPDATE kids_family_members SET revoked_at=${now},revision=revision+1 WHERE grant_id=? AND ${gate}`).bind(a.action==='leave'?a.grantId:a.targetGrantId,...tail));
 const results=await db().batch(statements),saved=await prior();if(!saved)throw new KidsError('Access changed, the recipient already has access, or this organizer reached its five-adult/five-invitation limit. Refresh access and retry the same request; for rate limits wait a minute.',409);return result(saved,!results[0].results.length,results[0].results.length?rawCode:undefined);
}
