import { env } from 'cloudflare:workers';
import { z } from 'zod';
import {resolveFamily,sharingEnabled,assertBinding,requireEditorCommand,activeStatus,cleanupSharing,type FamilyAccess} from './family-sharing';
import {connectionStatusSchema} from './family-status';
import {applyCommand,newWorkspace,newPolicy,publicPolicy,FamilyError,exportWorkspace,deploymentMode,deploymentCapabilities,requireModeCommand,serializeFamilyWrite,type Workspace,type CommandName} from './family';

type Row={purpose:'planner'|'account';user_id:string;id:string;revision:number;document:string;policy:string;operations:string;updated_at:string};
function db(){if(!env.DB)throw new FamilyError('Storage is unavailable. Nothing was saved.',503);return env.DB;}
export async function getFamilyConnectionStatus(userId:string){
  // Do not call getFamily(): diagnostics must not run metadata cleanup or read family content.
  const row=await activeStatus(userId);
  return connectionStatusSchema.parse({schemaVersion:1,app:'Family Ops',status:'ok',checkedAt:new Date().toISOString(),mode:getFamilyDeployment().mode,storage:'available',workspace:row?'present':'absent',revision:row?.revision??null,lastSavedAt:row?.updated_at??null});
}
export async function loadFamily(userId:string){return await db().prepare("SELECT * FROM workspace_state WHERE user_id = ? AND purpose='planner'").bind(userId).first<Row>();}
export function getFamilyDeployment(){const mode=deploymentMode(env.FAMILY_OPS_MODE);return {mode,capabilities:deploymentCapabilities(mode)};}
export function viewRow(row:Row,access:FamilyAccess={role:'owner',grantId:row.id}){const deployment=getFamilyDeployment();return {workspace:JSON.parse(row.document) as Workspace,revision:row.revision,policy:publicPolicy(JSON.parse(row.policy),Date.now(),deployment.mode),updatedAt:row.updated_at,access,sharing:{enabled:sharingEnabled()},...deployment};}
const metadataRetention=30*86400000;
async function cleanupFamilyMetadata(){
  const expired=Date.now()-metadataRetention;
  await db().batch([
    db().prepare('DELETE FROM workspace_deletion_receipts WHERE rowid IN (SELECT rowid FROM workspace_deletion_receipts WHERE deleted_at<=? ORDER BY deleted_at LIMIT 100)').bind(expired),
    db().prepare('DELETE FROM workspace_write_budget WHERE user_id IN (SELECT user_id FROM workspace_write_budget WHERE last_write_at<=? ORDER BY last_write_at LIMIT 100)').bind(expired),
  ]);
}
// Pure snapshot for read-only MCP tools: never performs activity-triggered metadata cleanup.
export async function readFamily(userId:string){const active=await resolveFamily(userId);return active?viewRow(active.row,active.access):{workspace:null,revision:0,policy:null,access:null,sharing:{enabled:sharingEnabled()},...getFamilyDeployment()};}
export async function getFamily(userId:string){await cleanupFamilyMetadata();await cleanupSharing();return readFamily(userId);}
async function boundedWrite<T>(userId:string,write:()=>Promise<T>):Promise<T>{
  try{return await write();}catch(error){
    if(error instanceof Error&&error.message.includes('FAMILY_RATE_LIMIT')){
      const budget=await db().prepare('SELECT MIN(CAST(value AS INTEGER)) AS oldest FROM workspace_write_budget,json_each(write_times) WHERE user_id=? AND CAST(value AS INTEGER)>?').bind(userId,Date.now()-60000).first<{oldest:number|null}>();
      const seconds=Math.max(1,Math.ceil(((budget?.oldest??Date.now())+60000-Date.now())/1000));
      throw new FamilyError(`Too many saves in a minute. Wait ${seconds} seconds, then retry this same change. Your earlier work is safe.`,429,seconds);
    }
    throw error;
  }
}
const onboard=z.object({name:z.string().trim().min(1).max(160),people:z.array(z.string().trim().min(1).max(160)).min(1).max(20),sample:z.boolean()}).strict();
export async function createFamily(userId:string,input:unknown){
  if(sharingEnabled()&&(await resolveFamily(userId))?.access.role==='editor')throw new FamilyError('Leave the shared household before creating a personal workspace.',403);
  const args=onboard.parse(input);const w=newWorkspace(args.name,args.people,args.sample),p=newPolicy();
  const account=await db().prepare("SELECT id FROM workspace_state WHERE user_id=? AND purpose='account'").bind(userId).first<{id:string}>();
  if(account)w.id=account.id;
  const serialized=serializeFamilyWrite(w,p,{});
  if(account){
    await boundedWrite(userId,()=>db().prepare("UPDATE workspace_state SET purpose='planner',document=?,policy=?,operations=?,revision=revision+1,updated_at=? WHERE user_id=? AND id=? AND purpose='account'"+(sharingEnabled()?' AND NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?)':'')).bind(serialized.document,serialized.policy,serialized.operations,new Date().toISOString(),userId,account.id,...(sharingEnabled()?[userId]:[])).run());
    return getFamily(userId);
  }
  await boundedWrite(userId,()=>db().prepare('INSERT INTO workspace_state (user_id,id,revision,document,policy,operations,updated_at) SELECT ?,?,1,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM workspace_state WHERE user_id=?)'+(sharingEnabled()?' AND NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?)':'')).bind(userId,w.id,serialized.document,serialized.policy,serialized.operations,new Date().toISOString(),userId,...(sharingEnabled()?[userId]:[])).run());
  return getFamily(userId);
}
const envelope=z.object({operationId:z.string().uuid(),baseRevision:z.number().int().min(1),type:z.string(),args:z.unknown(),workspaceId:z.string().uuid().optional(),grantId:z.string().uuid().optional()}).strict();
export async function mutateFamily(userId:string,input:unknown){
  const e=envelope.parse(input);requireModeCommand(getFamilyDeployment().mode,e.type);await cleanupFamilyMetadata();
  const active=await resolveFamily(userId);if(!active)throw new FamilyError('Create a workspace first.',404);assertBinding(active,e);requireEditorCommand(active.access.role,e.type,e.args);const {row,access}=active;
  const ops=JSON.parse(row.operations) as Record<string,{body:string;result:Record<string,unknown>}>;const body=JSON.stringify({type:e.type,args:e.args});
  if(ops[e.operationId]){if(ops[e.operationId].body!==body)throw new FamilyError('This retry belongs to a different change.',409);return {...viewRow(row,access),result:ops[e.operationId].result,retried:true};}
  if(row.revision!==e.baseRevision)throw new FamilyError('Your workspace changed in another tab. Reload before saving this change.',409);
  const next=applyCommand(JSON.parse(row.document),JSON.parse(row.policy),e.type as CommandName,e.args);
  ops[e.operationId]={body,result:next.result}; // Retain receipts: a delayed retry must never turn into a second operation.
  const serialized=serializeFamilyWrite(next.workspace,next.policy,ops);
  const updatedAt=new Date().toISOString();
  // The same grant must still authorize this exact household at commit; a revoked editor cannot write their parked board.
  const guard=sharingEnabled()?` AND id=? AND ((?='owner' AND user_id=? AND NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?)) OR (?='editor' AND ? IN ('createEvent','editEvent','addSection','editSection','moveSection','addItem','editItem','settings','person','field','fieldValue') AND NOT (?='settings' AND json_type(?,'$.personFilter') IS NOT NULL) AND EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=? AND owner_user_id=workspace_state.user_id AND workspace_id=workspace_state.id AND grant_id=?)))`:'';
  const values: (string|number)[]=[serialized.document,serialized.policy,serialized.operations,updatedAt,row.user_id,row.revision];
  if(sharingEnabled())values.push(row.id,access.role,userId,userId,access.role,e.type,e.type,JSON.stringify(e.args),userId,access.grantId);
  const result=await boundedWrite(row.user_id,()=>db().prepare('UPDATE workspace_state SET document=?,policy=?,operations=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?'+guard+' RETURNING revision').bind(...values).first<{revision:number}>());
  if(!result)throw new FamilyError('Another change arrived first. Reload before trying again.',409);
  return {...viewRow({...row,...serialized,revision:row.revision+1,updated_at:updatedAt},access),result:next.result};
}
const deletion=z.object({deleteWorkspace:z.literal(true),operationId:z.string().uuid(),workspaceId:z.string().uuid(),baseRevision:z.number().int().min(1),confirmed:z.literal(true),grantId:z.string().uuid().optional()}).strict();
type DeletionReceipt={workspace_id:string;base_revision:number};
export async function deleteFamily(userId:string,input:unknown){
  const e=deletion.parse(input);await cleanupFamilyMetadata();
  if(await db().prepare('SELECT id FROM kids_state WHERE user_id=?').bind(userId).first())throw new FamilyError('Remove your Kids workspace from Kids settings first, then delete this planner. This keeps Kids profiles from being left behind.',409);
  if(sharingEnabled()){const active=await resolveFamily(userId);if(active?.access.role==='editor')throw new FamilyError('Only the household owner can remove a workspace.',403);if(e.grantId!==e.workspaceId)throw new FamilyError('Confirm deletion in the current owner workspace.',403);}
  const receipt=()=>db().prepare('SELECT workspace_id,base_revision FROM workspace_deletion_receipts WHERE user_id=? AND operation_id=? AND deleted_at>?').bind(userId,e.operationId,Date.now()-metadataRetention).first<DeletionReceipt>();
  const checkReceipt=(r:DeletionReceipt)=>{if(r.workspace_id!==e.workspaceId||r.base_revision!==e.baseRevision)throw new FamilyError('This deletion retry belongs to a different workspace or revision.',409);};
  const result=async(retried:boolean)=>({...await getFamily(userId),result:{deletedWorkspaceId:e.workspaceId,retried}});
  const earlier=await receipt();if(earlier){checkReceipt(earlier);return result(true);}
  const row=await loadFamily(userId);if(!row||row.id!==e.workspaceId){const raced=await receipt();if(raced){checkReceipt(raced);return result(true);}throw new FamilyError('Workspace not found in this account.',404);}
  if(row.revision!==e.baseRevision)throw new FamilyError('Your workspace changed. Reload it and confirm deletion again.',409);
  const batch=await db().batch([
    db().prepare('INSERT INTO workspace_deletion_receipts (user_id,operation_id,workspace_id,base_revision,deleted_at) SELECT user_id,?,id,revision,? FROM workspace_state WHERE user_id=? AND id=? AND revision=? AND (?=0 OR NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?)) ON CONFLICT(user_id,operation_id) DO NOTHING').bind(e.operationId,Date.now(),userId,e.workspaceId,e.baseRevision,sharingEnabled()?1:0,userId),
    db().prepare('DELETE FROM workspace_state WHERE user_id=? AND id=? AND revision=? AND (?=0 OR NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=?)) AND EXISTS (SELECT 1 FROM workspace_deletion_receipts WHERE user_id=? AND operation_id=? AND workspace_id=? AND base_revision=?) RETURNING id').bind(userId,e.workspaceId,e.baseRevision,sharingEnabled()?1:0,userId,userId,e.operationId,e.workspaceId,e.baseRevision),
  ]);
  if(batch[1].results.length===1)return result(false);
  const concurrent=await receipt();if(concurrent){checkReceipt(concurrent);return result(true);}
  throw new FamilyError('Another change arrived first. Reload and confirm deletion again.',409);
}
export async function familyExport(userId:string){await cleanupFamilyMetadata();const active=await resolveFamily(userId);if(!active)throw new FamilyError('No workspace to export.',404);return exportWorkspace(JSON.parse(active.row.document));}
export function safeError(error:unknown){
  if(error instanceof Error&&error.message.includes('BILLING_CHECKOUT_PENDING'))return {status:409,message:'Finish or cancel the existing checkout before deleting this workspace. An uncertain checkout cannot be erased locally.'};
  if(error instanceof Error&&error.message.includes('BILLING_CANCEL_FIRST'))return {status:409,message:'Subscription cancellation must finish before deleting this workspace. Your plans and export remain available.'};
  if(error instanceof z.ZodError)return {status:400,message:error.issues[0]?.message??'Check the form values.'};
  if(error instanceof FamilyError)return {status:error.status,message:error.message,retryAfter:error.retryAfter};
  return {status:503,message:'The workspace could not be saved or loaded. Your earlier work is safe; try again.'};
}
