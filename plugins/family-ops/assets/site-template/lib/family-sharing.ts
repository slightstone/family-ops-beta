import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {FamilyError} from './family';
export type FamilyRow={purpose:'planner'|'account';user_id:string;id:string;revision:number;document:string;policy:string;operations:string;updated_at:string};
export type FamilyAccess={role:'owner'|'editor';grantId:string};
const db=()=>{if(!env.DB)throw new FamilyError('Storage is unavailable.',503);return env.DB;};
export function sharingEnabled(){return env.FAMILY_OPS_SHARING==='enabled'&&/^[a-f0-9]{64}$/.test(env.FAMILY_OPS_INVITE_KEY_V1??'');}
function requireSharing(){if(!sharingEnabled())throw new FamilyError('Adult sharing is not available in this workspace yet.',404);}
const hex=(bytes:ArrayBuffer|Uint8Array)=>Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');
export async function digest(value:string){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function recipientHash(email:string){
  requireSharing();const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.FAMILY_OPS_INVITE_KEY_V1!.match(/../g)!,x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return 'v1:'+hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(email.trim().toLowerCase())));
}
const binding=z.object({workspaceId:z.string().uuid(),grantId:z.string().uuid()}).strict();
export function assertBinding(access:{row:FamilyRow;access:FamilyAccess},input:{workspaceId?:string;grantId?:string}){
  if(!sharingEnabled())return;
  const p=binding.safeParse({workspaceId:input.workspaceId,grantId:input.grantId});
  if(!p.success||p.data.workspaceId!==access.row.id||p.data.grantId!==access.access.grantId)throw new FamilyError('Access changed. Keep your unsaved entry before returning to your own workspace.',403);
}
export const editorCommands=['createEvent','editEvent','addSection','editSection','moveSection','addItem','editItem','settings','person','field','fieldValue'] as const;
export function requireEditorCommand(role:FamilyAccess['role'],type:string,args:unknown){
  if(role==='editor'&&(!(editorCommands as readonly string[]).includes(type)||(type==='settings'&&typeof args==='object'&&args!==null&&Object.hasOwn(args,'personFilter'))))throw new FamilyError('Only the household owner can make this change.',403);
}
export async function resolveFamily(userId:string){
  if(sharingEnabled()){
    const row=await db().prepare("SELECT w.*,m.grant_id FROM workspace_memberships m JOIN workspace_state w ON w.user_id=m.owner_user_id AND w.id=m.workspace_id WHERE m.member_user_id=? AND w.purpose='planner'").bind(userId).first<FamilyRow&{grant_id:string}>();
    if(row)return {row,access:{role:'editor',grantId:row.grant_id} as FamilyAccess};
  }
  const row=await db().prepare("SELECT * FROM workspace_state WHERE user_id=? AND purpose='planner'").bind(userId).first<FamilyRow>();
  return row?{row,access:{role:'owner',grantId:row.id} as FamilyAccess}:null;
}
export async function activeStatus(userId:string){
  if(sharingEnabled()){
    const row=await db().prepare("SELECT w.revision,w.updated_at FROM workspace_memberships m JOIN workspace_state w ON w.user_id=m.owner_user_id AND w.id=m.workspace_id WHERE m.member_user_id=? AND w.purpose='planner'").bind(userId).first<{revision:number;updated_at:string}>();
    if(row)return row;
  }
  return db().prepare("SELECT revision,updated_at FROM workspace_state WHERE user_id=? AND purpose='planner'").bind(userId).first<{revision:number;updated_at:string}>();
}
export async function cleanupSharing(){
  if(!sharingEnabled())return;const cutoff=Date.now()-30*86400000;
  await db().batch([
    db().prepare('DELETE FROM workspace_access_operations WHERE rowid IN (SELECT rowid FROM workspace_access_operations WHERE committed_at<=? ORDER BY committed_at LIMIT 100)').bind(cutoff),
    db().prepare('DELETE FROM workspace_invitations WHERE id IN (SELECT i.id FROM workspace_invitations i WHERE i.expires_at<=? AND NOT EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.invitation_id=i.id) ORDER BY i.expires_at LIMIT 100)').bind(cutoff),
    db().prepare('DELETE FROM workspace_access_budget WHERE actor_id IN (SELECT actor_id FROM workspace_access_budget WHERE last_write_at<=? ORDER BY last_write_at LIMIT 100)').bind(cutoff),
  ]);
}
export async function getAccessState(userId:string){
  if(!sharingEnabled())return {enabled:false};
  const active=await resolveFamily(userId);if(!active)return {enabled:true,role:null};
  const {row,access}=active;
  if(access.role==='editor')return {enabled:true,workspaceId:row.id,household:JSON.parse(row.document).name,access,hasPersonal:!!await db().prepare('SELECT 1 FROM workspace_state WHERE user_id=?').bind(userId).first()};
  const members=await db().prepare('SELECT grant_id AS grantId,label,hint,joined_at AS joinedAt FROM workspace_memberships WHERE owner_user_id=? AND workspace_id=? ORDER BY joined_at,grant_id').bind(userId,row.id).all();
  const invitations=await db().prepare('SELECT id,label,hint,expires_at AS expiresAt FROM workspace_invitations WHERE owner_user_id=? AND workspace_id=? AND cancelled_at IS NULL AND accepted_at IS NULL AND expires_at>CAST((julianday(\'now\')-2440587.5)*86400000 AS INTEGER) ORDER BY created_at,id').bind(userId,row.id).all();
  return {enabled:true,workspaceId:row.id,household:JSON.parse(row.document).name,access,members:members.results,invitations:invitations.results};
}
const code=z.string().regex(/^[a-f0-9]{64}$/);
const base={operationId:z.string().uuid(),createdAt:z.number().int().nonnegative(),workspaceId:z.string().uuid(),confirmed:z.literal(true)};
const request=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('create'),grantId:z.string().uuid(),email:z.string().trim().email().max(254),label:z.string().trim().min(1).max(80).refine(s=>!s.includes('@'),'Use a name for the adult label, without an email address.')}).strict(),
 z.object({...base,action:z.literal('cancel'),grantId:z.string().uuid(),invitationId:z.string().uuid()}).strict(),
 z.object({...base,action:z.literal('revoke'),grantId:z.string().uuid(),targetGrantId:z.string().uuid()}).strict(),
 z.object({...base,action:z.literal('accept'),invitationId:z.string().uuid(),code}).strict(),
 z.object({...base,action:z.literal('leave'),grantId:z.string().uuid()}).strict(),
]);
type Invitation={id:string;owner_user_id:string;workspace_id:string;token_hash:string;recipient_hash:string;expires_at:number;cancelled_at:number|null;accepted_at:number|null};
const unavailable=()=>new FamilyError('This invitation is unavailable for this account. Check the code, account or ask the owner for a new invitation.',404);
async function invitationFor(codeValue:string,email:string){
  const tokenHash=await digest(codeValue),actorHash=await recipientHash(email);
  const invitation=await db().prepare('SELECT * FROM workspace_invitations WHERE token_hash=? AND recipient_hash=? AND cancelled_at IS NULL AND accepted_at IS NULL AND expires_at>CAST((julianday(\'now\')-2440587.5)*86400000 AS INTEGER)').bind(tokenHash,actorHash).first<Invitation>();
  if(!invitation)throw unavailable();return {invitation,tokenHash,actorHash};
}
export async function previewInvitation(email:string,input:unknown){
 requireSharing();const a=z.object({action:z.literal('preview'),code}).strict().parse(input);const {invitation}=await invitationFor(a.code,email);
 const row=await db().prepare('SELECT json_extract(document,\'$.name\') AS name FROM workspace_state WHERE user_id=? AND id=?').bind(invitation.owner_user_id,invitation.workspace_id).first<{name:string}>();if(!row)throw unavailable();
 return {invitationId:invitation.id,workspaceId:invitation.workspace_id,household:row.name,expiresAt:invitation.expires_at,role:'editor'};
}
type Operation={body_hash:string;kind:string;workspace_id:string;payload:string};
export async function changeAccess(user:{userId:string;email:string},input:unknown){
 requireSharing();const a=request.parse(input);const actorHash=await recipientHash(user.email);
 // Raw recipient addresses and invitation codes never enter receipts.
 const fingerprint={...a} as Record<string,unknown>;delete fingerprint.code;delete fingerprint.email;
 if(a.action==='create')fingerprint.recipientHash=await recipientHash(a.email);
 if(a.action==='accept')fingerprint.tokenHash=await digest(a.code);
 const bodyHash=await digest(JSON.stringify(fingerprint));
 const findReceipt=()=>db().prepare('SELECT body_hash,kind,workspace_id,payload FROM workspace_access_operations WHERE actor_id=? AND operation_id=?').bind(user.userId,a.operationId).first<Operation>();
 const outcome=async(op:Operation,retried:boolean,newCode?:string)=>{
   if(op.body_hash!==bodyHash)throw new FamilyError('This retry belongs to a different access change.',409);
   const p=JSON.parse(op.payload);let state='completed';
   if(op.kind==='create'){const i=await db().prepare('SELECT cancelled_at,accepted_at,expires_at FROM workspace_invitations WHERE id=?').bind(p.invitationId).first<Invitation>();state=!i?'ended':i.accepted_at!==null?'accepted':i.cancelled_at!==null||i.expires_at<=Date.now()?'ended':'pending';}
   if(op.kind==='accept'){const m=await db().prepare('SELECT 1 FROM workspace_memberships WHERE member_user_id=? AND grant_id=? AND workspace_id=?').bind(user.userId,p.newGrantId,op.workspace_id).first();state=m?'joined':'ended';}
   return {state,retried,invitationId:op.kind==='create'?p.invitationId:undefined,code:op.kind==='create'?newCode??null:undefined,accessState:await getAccessState(user.userId)};
 };
 const earlier=await findReceipt();if(earlier)return outcome(earlier,true);
 let ownerId:string,payload:Record<string,unknown>,rawCode:string|undefined;
 if(a.action==='accept'){
   const {invitation,tokenHash}=await invitationFor(a.code,user.email);if(invitation.id!==a.invitationId||invitation.workspace_id!==a.workspaceId)throw unavailable();
   ownerId=invitation.owner_user_id;payload={invitationId:a.invitationId,tokenHash,actorHash,newGrantId:crypto.randomUUID()};
 }else{
   const active=await resolveFamily(user.userId);if(!active)throw new FamilyError('Open your workspace first.',404);assertBinding(active,a);
   if(a.action!=='leave'&&active.access.role!=='owner')throw new FamilyError('Only the household owner can manage access.',403);
   if(a.action==='leave'&&active.access.role!=='editor')throw new FamilyError('You are not an editor in this household.',409);
   ownerId=active.row.user_id;payload={grantId:a.grantId};
   if(a.action==='create'){
     rawCode=hex(crypto.getRandomValues(new Uint8Array(32)));const email=a.email.trim().toLowerCase();
     payload={...payload,actorHash,recipientHash:fingerprint.recipientHash,invitationId:crypto.randomUUID(),tokenHash:await digest(rawCode),label:a.label,hint:email[0]+'•••@'+email.split('@')[1][0]+'•••'};
   }
   if(a.action==='cancel')payload.invitationId=a.invitationId;
   if(a.action==='revoke')payload.targetGrantId=a.targetGrantId;
 }
 try{
   // NOT EXISTS suppresses triggers on an exact replay. RETURNING identifies the winning insert, not trigger-inflated changes.
   const inserted=await db().prepare('INSERT INTO workspace_access_operations(actor_id,operation_id,kind,owner_user_id,workspace_id,body_hash,payload,created_at,committed_at) SELECT ?,?,?,?,?,?,?,?,CAST((julianday(\'now\')-2440587.5)*86400000 AS INTEGER) WHERE NOT EXISTS(SELECT 1 FROM workspace_access_operations WHERE actor_id=? AND operation_id=?) RETURNING operation_id').bind(user.userId,a.operationId,a.action,ownerId,a.workspaceId,bodyHash,JSON.stringify(payload),a.createdAt,user.userId,a.operationId).first();
   const receipt=await findReceipt();if(!receipt)throw new FamilyError('This change could not be confirmed. Retry the same change.',503);
   return outcome(receipt,!inserted,inserted?rawCode:undefined);
 }catch(error){
   const msg=error instanceof Error?error.message:'';
   if(msg.includes('ACCESS_RATE_LIMIT'))throw new FamilyError('Too many access changes. Wait one minute, then retry this same change.',429,60);
   if(msg.includes('ACCESS_STALE'))throw new FamilyError('This request is too old. Refresh access settings and confirm a new change.',409);
   if(msg.includes('ACCESS_DUPLICATE'))throw new FamilyError('A live invitation for this address already exists. Cancel it before creating another.',409);
   if(msg.includes('ACCESS_INVITE_LIMIT')||msg.includes('ACCESS_MEMBER_LIMIT'))throw new FamilyError('This household has reached its five-adult or five-invitation limit.',409);
   if(msg.includes('ACCESS_ALREADY_JOINED'))throw new FamilyError('Leave your current shared household before joining another.',409);
   if(msg.includes('ACCESS_SELF'))throw new FamilyError('The owner already has access. Invite a different adult.',400);
   if(msg.includes('ACCESS_'))throw unavailable();
   throw error;
 }
}
