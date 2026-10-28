import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {KidsError} from './kids';
import {kidsHash,readKids} from './kids-store';
import {ownedInstallation} from './owned-installation';
import {noRemovalSql} from './kids-hosted-removal-state';
import {billingNowSql as clock} from './stripe-provider';

export const installationInput=z.object({action:z.enum(['activate','pause']),operation_id:z.string().uuid(),workspace_id:z.string().uuid(),expected_revision:z.number().int().min(1)}).strict();
type Grant={kind:string;grant_id:string;revision:number;revoked_at:number|null;created_at:number};
type Workspace={id:string;revision:number};
type Receipt={body_hash:string;committed_revision:number;source_authority:string|null};
const db=()=>{if(!env.DB)throw new KidsError('Private installation storage is unavailable. Saved work is unchanged.',503);return env.DB;};
const conflict=()=>new KidsError('Private installation changed. Reopen setup before retrying. Your saved board is preserved.',409);

// Returns only this authenticated requester's own native Site-scoped identity, not the configured owner's identity.
export function kidsInstallationIdentity(user:string){const mode=ownedInstallation();return {requesterUserId:user,mode:mode.kind==='shared'?'shared':'customer-owned',configured:mode.kind==='owned',ownerMatches:mode.kind==='owned'&&mode.ownerId===user,coverage:'Installation metadata only; no family records, provider call or write.'};}

/** Explicit native owner action. Rotation must pause the durable grant before publishing changed configuration. */
export async function maintainKidsInstallation(user:string,input:unknown){
 const a=installationInput.parse(input),mode=ownedInstallation();
 if(mode.kind!=='owned'||mode.ownerId!==user)throw new KidsError('Only this private installation’s configured owner can finish or pause setup.',403);
 const row=await db().prepare('SELECT id,revision FROM kids_state WHERE user_id=? AND id=?').bind(user,a.workspace_id).first<Workspace>();if(!row)throw conflict();
 const hash=await kidsHash(JSON.stringify(['owned-installation-v1',a.action,a.workspace_id,a.expected_revision,mode.ownerId,mode.installationId]));
 const old=await db().prepare('SELECT kind,grant_id,revision,revoked_at,created_at FROM kids_service_access WHERE owner_user_id=? AND workspace_id=?').bind(user,row.id).first<Grant>();
 const receipt=await db().prepare('SELECT body_hash,committed_revision,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,row.id,a.operation_id).first<Receipt>();
 if(receipt){
  if(receipt.body_hash!==hash||!receipt.source_authority)throw conflict();
  const proof=z.object({kind:z.literal('owned-installation-v1'),action:z.enum(['activate','pause']),grantId:z.string().uuid(),revision:z.number().int().min(1)}).safeParse(JSON.parse(receipt.source_authority));
  if(!proof.success||!old||old.kind!=='owned'||proof.data.action!==a.action||old.grant_id!==proof.data.grantId||old.revision!==proof.data.revision||(old.revoked_at!==null)!==(a.action==='pause'))throw conflict();
  return {saved:true,retried:true,committedRevision:receipt.committed_revision,...await readKids(user)};
 }
 if(row.revision!==a.expected_revision)throw conflict();
 if(old&&old.kind!=='owned')throw new KidsError('This workspace already has shared service access. Use a separate private installation; its grant and saved work were not changed.',409);
 if(old&&old.grant_id!==mode.installationId&&old.revoked_at===null)throw new KidsError('Pause the previous installation before changing its runtime configuration. Saved work is unchanged.',409);
 if(a.action==='pause'&&(!old||old.grant_id!==mode.installationId))throw conflict();
 if(await db().prepare('SELECT 1 FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=? LIMIT 1').bind(user,row.id,a.operation_id,user,row.id,a.operation_id).first())throw conflict();
 if(!await db().prepare(`SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND ${noRemovalSql}`).bind(user,row.id).first())throw conflict();
 const already=old?.grant_id===mode.installationId&&(old.revoked_at!==null)===(a.action==='pause');
 if(already)return {saved:false,alreadyConfigured:true,...await readKids(user)};
 const nonce=crypto.randomUUID(),revision=(old?.revision??0)+1,active='EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?)';
 const oldFence=old?`EXISTS(SELECT 1 FROM kids_service_access a WHERE a.owner_user_id=kids_state.user_id AND a.workspace_id=kids_state.id AND a.kind='owned' AND a.grant_id=? AND a.revision=? AND a.created_at<=${clock} AND a.revoked_at IS ?)`:'NOT EXISTS(SELECT 1 FROM kids_service_access a WHERE a.owner_user_id=kids_state.user_id AND a.workspace_id=kids_state.id)';
 const statements=[db().prepare(`UPDATE kids_state SET revision=revision+1,updated_at=?,last_write_nonce=? WHERE user_id=? AND id=? AND revision=? AND ${oldFence} AND ${noRemovalSql} AND NOT EXISTS(SELECT 1 FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=?) AND NOT EXISTS(SELECT 1 FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=?) RETURNING revision`).bind(new Date().toISOString(),nonce,user,row.id,row.revision,...(old?[old.grant_id,old.revision,old.revoked_at]:[]),user,row.id,a.operation_id,user,row.id,a.operation_id)];
 if(old)statements.push(db().prepare(`DELETE FROM kids_service_access WHERE owner_user_id=? AND workspace_id=? AND kind='owned' AND grant_id=? AND revision=? AND ${active}`).bind(user,row.id,old.grant_id,old.revision,user,row.id,nonce));
 statements.push(db().prepare(`INSERT INTO kids_service_access(owner_user_id,workspace_id,grant_id,revision,kind,beta_until,billing_workspace_id,revoked_at,created_at,updated_at) SELECT user_id,id,?,?,'owned',NULL,NULL,${a.action==='pause'?clock:'NULL'},${old?'?':clock},${clock} FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?`).bind(mode.installationId,revision,...(old?[old.created_at]:[]),user,row.id,nonce));
 statements.push(db().prepare(`INSERT INTO kids_operation_receipts(owner_user_id,workspace_id,operation_id,body_hash,committed_revision,created_at,source_authority) SELECT user_id,id,?,?,revision,${clock},? FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?`).bind(a.operation_id,hash,JSON.stringify({kind:'owned-installation-v1',action:a.action,grantId:mode.installationId,revision}),user,row.id,nonce));
 const result=await db().batch(statements);if(result[0].results.length!==1)throw conflict();
 return {saved:true,retried:false,committedRevision:row.revision+1,...await readKids(user)};
}
