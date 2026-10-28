// Offline proposal only. Never executes SQL, opens accounts or grants access.
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
const {values:v}=parseArgs({options:{owner:{type:'string'},workspace:{type:'string'},kind:{type:'string'},until:{type:'string'},billing:{type:'string'},'expected-grant':{type:'string'},'expected-revision':{type:'string'},revoke:{type:'boolean'}}});
const uid=s=>typeof s==='string'&&/^[A-Za-z0-9_:-]{1,180}$/u.test(s),uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(s);
const revision=Number(v['expected-revision']);
if(!uid(v.owner)||!uuid(v.workspace)||v['expected-grant']&&!uuid(v['expected-grant'])||v['expected-grant']&&(!Number.isSafeInteger(revision)||revision<1)||!v['expected-grant']&&v['expected-revision'])throw new Error('Explicit owner/workspace and a matching expected grant/revision (or neither for absence) are required.');
const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)",statements=[],scope=[v.owner,v.workspace];
if(v.revoke){
 if(!v['expected-grant']||v.kind||v.until||v.billing)throw new Error('Revocation requires only the exact expected grant and revision.');
 statements.push({sql:`UPDATE kids_service_access SET revision=revision+1,revoked_at=${clock},updated_at=${clock} WHERE owner_user_id=? AND workspace_id=? AND grant_id=? AND revision=? AND revoked_at IS NULL RETURNING grant_id,revision,revoked_at`,bindings:[...scope,v['expected-grant'],revision]});
}else{
 const until=v.until?Date.parse(v.until):null;
 if(v.until&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(v.until)||!Number.isFinite(until)||new Date(until).toISOString().replace('.000Z','Z')!==v.until.replace('.000Z','Z')))throw new Error('Use an exact real UTC ISO expiry, including time and Z.');
 if(v.kind==='beta'?!(until&&Number.isSafeInteger(until)&&until>Date.now()&&!v.billing):v.kind==='subscription'?!(uuid(v.billing)&&!v.until):true)throw new Error('Choose beta with an exact future ISO expiry, or subscription with an explicit billing workspace.');
 if(v['expected-grant'])statements.push({sql:'DELETE FROM kids_service_access WHERE owner_user_id=? AND workspace_id=? AND grant_id=? AND revision=? RETURNING grant_id',bindings:[...scope,v['expected-grant'],revision]});
 statements.push({sql:`INSERT INTO kids_service_access(owner_user_id,workspace_id,grant_id,revision,kind,beta_until,billing_workspace_id,revoked_at,created_at,updated_at) SELECT ?,?,?,1,?,?,?,NULL,${clock},${clock} WHERE EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=?) AND NOT EXISTS(SELECT 1 FROM kids_service_access WHERE owner_user_id=? AND workspace_id=?) RETURNING grant_id,revision,kind,beta_until,billing_workspace_id`,bindings:[...scope,randomUUID(),v.kind,until,v.billing??null,...scope,...scope]});
}
console.log(JSON.stringify({proposalOnly:true,approved:false,executed:false,atomicD1BatchRequired:true,expectedResults:statements.map(()=>1),warning:'Review the exact owner, Kids workspace, billing/expiry and expected grant. Apply only after action-specific approval, as one D1 batch; zero rows is a conflict, never success. Retain the returned grant ID for retry reconciliation. Never rerun a replacement as a new grant after a lost response without reconciling current state.',statements},null,2));
