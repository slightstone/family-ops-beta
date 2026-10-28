import {KidsError} from './kids-error';

export type HostedSourceOutcome={id:string;fingerprint:string;factCount:number;taskCount:number};
type Input={id:string;fingerprint:string;facts:{tasks:unknown[]}[]|{tasks:unknown[]}|null};
/** Server-derived metadata only. Never retain an extra original or translation. */
export function hostedSourceOutcomes(messages:Input[],versions:{messageId:string;fingerprint:string}[]):HostedSourceOutcome[]{
 if(!messages.length||messages.length>10||messages.length!==versions.length||new Set(messages.map(m=>m.id)).size!==messages.length)throw new KidsError('The saved source outcome identities could not be verified.',409);
 return messages.map(m=>{
  if(!versions.some(v=>v.messageId===m.id&&v.fingerprint===m.fingerprint))throw new KidsError('The saved source outcome version changed.',409);
  const facts=m.facts===null?[]:Array.isArray(m.facts)?m.facts:[m.facts],factCount=facts.length,taskCount=facts.reduce((n,f)=>n+f.tasks.length,0);
  if(factCount>8||taskCount>240)throw new KidsError('The saved source outcome exceeds its bounded interpretation.',409);
  return {id:m.id,fingerprint:m.fingerprint,factCount,taskCount};
 }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}

/** Structural proof shared by the immutable receipt guard and metadata read. */
export function hostedOutcomeSetSql(authority:string,batch:string){
 const entry="CASE WHEN o.type='object' THEN o.value ELSE '{}' END";
 const value=(field:string)=>`json_extract(${entry},'$.${field}')`;
 const matches=`((${batch}.source_kind='history' AND EXISTS(SELECT 1 FROM kids_hosted_history_batch_members m WHERE m.batch_id=${batch}.id AND m.message_id=${value('id')} AND m.fingerprint=${value('fingerprint')})) OR (${batch}.source_kind='webhook' AND EXISTS(SELECT 1 FROM kids_hosted_batch_members m WHERE m.batch_id=${batch}.id AND m.message_id=${value('id')} AND m.fingerprint=${value('fingerprint')})))`;
 return `CASE WHEN json_valid(${authority}) THEN (json_type(${authority},'$.outcomeVersion')='integer' AND json_extract(${authority},'$.outcomeVersion')=1
 AND json_type(${authority},'$.outcomes')='array'
 AND json_array_length(${authority},'$.outcomes') BETWEEN 1 AND 10
 AND json_array_length(${authority},'$.outcomes')=CASE ${batch}.source_kind WHEN 'history' THEN (SELECT COUNT(*) FROM kids_hosted_history_batch_members m WHERE m.batch_id=${batch}.id) WHEN 'webhook' THEN (SELECT COUNT(*) FROM kids_hosted_batch_members m WHERE m.batch_id=${batch}.id) ELSE -1 END
 AND (SELECT COUNT(DISTINCT json_extract(${entry},'$.id')) FROM json_each(${authority},'$.outcomes') o)=json_array_length(${authority},'$.outcomes')
 AND NOT EXISTS(SELECT 1 FROM json_each(${authority},'$.outcomes') o WHERE
 o.type<>'object' OR COALESCE(json_type(${entry},'$.id'),'')<>'text' OR COALESCE(json_type(${entry},'$.fingerprint'),'')<>'text'
 OR COALESCE(json_type(${entry},'$.factCount'),'')<>'integer' OR COALESCE(json_type(${entry},'$.taskCount'),'')<>'integer'
 OR ${value('factCount')} NOT BETWEEN 0 AND 8 OR ${value('taskCount')} NOT BETWEEN 0 AND 240
 OR (${value('factCount')}=0 AND ${value('taskCount')}<>0) OR NOT ${matches})) ELSE 0 END`;
}
