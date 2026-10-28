import {savedSourceChatSql,receiptSourceIdentitySql,batchAppIdentitySql} from './kids-source-authority';
import {billingNowSql as clock} from './stripe-provider';
import {hostedOutcomeSetSql} from './kids-source-outcomes';

export type HistoryInterpretationProgress={retained:number;waiting:number;reserved:number;savedFacts:number;savedZeroFacts:number;legacySaved:number;superseded:number;indeterminate:number;factCount:number;taskCount:number;reconciled:boolean;observedAt:string};
export type HistoryTransportProgress={inspected:number;outsideWindow:number;unsupported:number;previouslyKnown:number;retained:number;repeatedEntries:number;reconciled:boolean};
type Row={authority_json:string;id:string;chat_id:string;status:string;gap:string|null;since:number;until:number;page_count:number;seen_count:number;oldest:number|null;newest:number|null;retained:number;waiting:number;reserved:number;savedFacts:number;savedZeroFacts:number;legacySaved:number;superseded:number;indeterminate:number;factCount:number;taskCount:number;outsideWindow:number;unsupported:number;previouslyKnown:number;accepted:number;rawCount:number;invalidPages:number;observed_at:number};

/** One metadata-only SQLite snapshot. No source body, translation or task text. */
export async function readKidsHistoryProgress(db:D1Database,user:string,workspace:string,epoch:number){
 const authority="CASE WHEN json_valid(r.source_authority) THEN r.source_authority ELSE '{}' END",proof=hostedOutcomeSetSql(authority,'b');
 const tuple=(field:string)=>`(SELECT json_extract(o.value,'$.${field}') FROM json_each(a.authority,'$.outcomes') o WHERE json_extract(o.value,'$.id')=m.message_id AND json_extract(o.value,'$.fingerprint')=m.fingerprint LIMIT 1)`;
 const rows=(await db.prepare(`
 WITH scans AS (
  SELECT s.*,s.rowid scan_order FROM kids_hosted_history_scans s JOIN kids_hosted_bindings b ON b.id=s.binding_id
  WHERE s.owner_user_id=? AND s.workspace_id=? AND b.active=1 AND b.removed_at IS NULL
  AND json_extract(s.authority_json,'$.epoch')=? AND json_extract(s.authority_json,'$.bindingRevision')=b.revision
  AND COALESCE(json_extract(s.authority_json,'$.connectionEpoch'),0)=COALESCE((SELECT c.source_epoch FROM kids_source_connections c WHERE c.owner_user_id=s.owner_user_id AND c.workspace_id=s.workspace_id AND c.binding_id=s.binding_id),0)
  ORDER BY s.rowid DESC LIMIT 30
 ), messages AS (
  SELECT m.sequence,m.page_id,m.binding_id,m.binding_revision,m.epoch,m.chat_id,m.message_id,m.body_hash,m.fingerprint,m.raw_bytes,m.consumed_at,json_extract(s.authority_json,'$.chatId') app_chat_id,COALESCE(json_extract(s.authority_json,'$.connectionEpoch'),0) connection_epoch,
   p.scan_id,p.status page_status,p.response_hash,s.owner_user_id,s.workspace_id,s.authority_json,
   s.binding_id scan_binding,s.chat_id scan_chat
  FROM scans s JOIN kids_hosted_history_pages p ON p.scan_id=s.id JOIN kids_hosted_history_messages m ON m.page_id=p.id
 ), audit AS (
  SELECT b.id,b.source_kind,${authority} authority,
   CASE WHEN r.body_hash=b.submitted_hash AND r.committed_revision=b.committed_revision AND json_valid(r.source_authority)
    AND json_extract(${authority},'$.kind')='hosted-source-batch-v1' AND json_extract(${authority},'$.batchId')=b.id
    AND json_extract(${authority},'$.sourceKind')=b.source_kind AND json_extract(${authority},'$.bindingId')=b.binding_id
    AND json_extract(${authority},'$.bindingRevision')=b.binding_revision AND json_extract(${authority},'$.epoch')=b.epoch
    THEN CASE WHEN json_type(${authority},'$.outcomeVersion') IS NULL AND json_type(${authority},'$.outcomes') IS NULL AND b.app_chat_id IS NULL AND b.connection_epoch=0 AND ${batchAppIdentitySql('b')} THEN 'legacy'
     WHEN ${proof} AND ${receiptSourceIdentitySql(authority,'b')} THEN 'valid' ELSE 'invalid' END ELSE 'invalid' END state
  FROM kids_hosted_batches b LEFT JOIN kids_operation_receipts r ON r.owner_user_id=b.owner_user_id AND r.workspace_id=b.workspace_id AND r.operation_id=b.operation_id
  WHERE b.status='saved' AND b.source_kind='history' AND EXISTS(
   SELECT 1 FROM messages m JOIN kids_hosted_history_batch_members x ON x.message_sequence=m.sequence
   WHERE x.batch_id=b.id AND b.owner_user_id=m.owner_user_id AND b.workspace_id=m.workspace_id AND b.binding_id=m.binding_id
    AND b.binding_revision=m.binding_revision AND b.epoch=m.epoch AND x.body_hash=m.body_hash AND x.fingerprint=m.fingerprint AND x.chat_id=m.chat_id AND x.message_id=m.message_id)
 ), saved AS (
  SELECT m.sequence,COUNT(DISTINCT a.id) saved_count,MAX(a.state) state,
   MAX(CASE WHEN a.state='valid' THEN ${tuple('factCount')} END) facts,
   MAX(CASE WHEN a.state='valid' THEN ${tuple('taskCount')} END) tasks
  FROM messages m JOIN kids_hosted_history_batch_members x ON x.message_sequence=m.sequence
  JOIN audit a ON a.id=x.batch_id
  WHERE x.body_hash=m.body_hash AND x.fingerprint=m.fingerprint AND x.chat_id=m.chat_id AND x.message_id=m.message_id GROUP BY m.sequence
 ), classified AS (
  SELECT m.scan_id,CASE
   WHEN m.page_status<>'committed' OR m.response_hash IS NULL OR m.binding_id<>m.scan_binding OR m.chat_id<>m.scan_chat
    OR m.binding_revision<>json_extract(m.authority_json,'$.bindingRevision') OR m.epoch<>json_extract(m.authority_json,'$.epoch') OR NOT COALESCE(${receiptSourceIdentitySql('m.authority_json','m')},0) OR json_type(m.authority_json,'$.chatId') IS NOT 'text' OR (json_type(m.authority_json,'$.providerChatId') IS NULL)<>(json_type(m.authority_json,'$.connectionEpoch') IS NULL) THEN 'indeterminate'
   WHEN saved.saved_count>0 THEN CASE WHEN m.consumed_at IS NULL OR saved.saved_count<>1 THEN 'indeterminate'
    WHEN saved.state='legacy' THEN 'legacySaved' WHEN saved.state='valid' AND saved.facts>0 THEN 'savedFacts'
    WHEN saved.state='valid' AND saved.facts=0 THEN 'savedZeroFacts' ELSE 'indeterminate' END
   WHEN m.consumed_at IS NOT NULL AND EXISTS(
    SELECT 1 FROM kids_hosted_message_heads h JOIN kids_source_records r ON r.owner_user_id=m.owner_user_id AND r.workspace_id=m.workspace_id
     AND ${savedSourceChatSql('h.binding_id','h.chat_id','r')} AND r.message_id=h.message_id AND r.fingerprint=h.fingerprint
    WHERE h.binding_id=m.binding_id AND h.chat_id=m.chat_id AND h.message_id=m.message_id) THEN 'superseded'
   WHEN m.consumed_at IS NULL AND m.raw_bytes>0 AND EXISTS(
    SELECT 1 FROM kids_hosted_history_batch_members x JOIN kids_hosted_batches b ON b.id=x.batch_id
    WHERE x.message_sequence=m.sequence AND x.body_hash=m.body_hash AND x.fingerprint=m.fingerprint
     AND b.binding_id=m.binding_id AND b.binding_revision=m.binding_revision AND b.epoch=m.epoch
     AND b.owner_user_id=m.owner_user_id AND b.workspace_id=m.workspace_id AND b.status='ready' AND b.source_kind='history' AND b.expires_at>${clock}) THEN 'reserved'
   WHEN m.consumed_at IS NULL AND m.raw_bytes>0 AND NOT EXISTS(SELECT 1 FROM kids_hosted_events w WHERE w.binding_id=m.binding_id AND w.chat_id=m.chat_id AND w.message_id=m.message_id)
    AND NOT EXISTS(SELECT 1 FROM kids_hosted_message_heads h WHERE h.binding_id=m.binding_id AND h.chat_id=m.chat_id AND h.message_id=m.message_id) THEN 'waiting'
   ELSE 'indeterminate' END bucket,
   CASE WHEN saved.saved_count=1 AND saved.state='valid' AND m.consumed_at IS NOT NULL THEN saved.facts ELSE 0 END facts,
   CASE WHEN saved.saved_count=1 AND saved.state='valid' AND m.consumed_at IS NOT NULL THEN saved.tasks ELSE 0 END tasks
  FROM messages m LEFT JOIN saved ON saved.sequence=m.sequence
 ), progress AS (
  SELECT scan_id,COUNT(*) retained,SUM(bucket='waiting') waiting,SUM(bucket='reserved') reserved,SUM(bucket='savedFacts') savedFacts,
   SUM(bucket='savedZeroFacts') savedZeroFacts,SUM(bucket='legacySaved') legacySaved,SUM(bucket='superseded') superseded,SUM(bucket='indeterminate') indeterminate,
   SUM(CASE WHEN bucket IN ('savedFacts','savedZeroFacts') THEN facts ELSE 0 END) factCount,SUM(CASE WHEN bucket IN ('savedFacts','savedZeroFacts') THEN tasks ELSE 0 END) taskCount FROM classified GROUP BY scan_id
 ), transport AS (
  SELECT p.scan_id,
   SUM(CASE WHEN json_valid(p.result_json) THEN COALESCE(json_extract(p.result_json,'$.rawCount'),0) ELSE 0 END) rawCount,
   SUM(CASE WHEN json_valid(p.result_json) THEN COALESCE(json_extract(p.result_json,'$.outsideWindow'),0) ELSE 0 END) outsideWindow,
   SUM(CASE WHEN json_valid(p.result_json) THEN COALESCE(json_extract(p.result_json,'$.unsupportedCount'),0) ELSE 0 END) unsupported,
   SUM(CASE WHEN json_valid(p.result_json) THEN COALESCE(json_array_length(p.result_json,'$.knownSkippedIds'),0) ELSE 0 END) previouslyKnown,
   SUM(CASE WHEN json_valid(p.result_json) THEN COALESCE(json_array_length(p.result_json,'$.acceptedIds'),0) ELSE 0 END) accepted,
   SUM(NOT json_valid(p.result_json)) invalidPages
  FROM kids_hosted_history_pages p JOIN scans s ON s.id=p.scan_id WHERE p.status='committed' GROUP BY p.scan_id
 ) SELECT s.*,${clock} observed_at,
  COALESCE(p.retained,0) retained,COALESCE(p.waiting,0) waiting,COALESCE(p.reserved,0) reserved,COALESCE(p.savedFacts,0) savedFacts,
  COALESCE(p.savedZeroFacts,0) savedZeroFacts,COALESCE(p.legacySaved,0) legacySaved,COALESCE(p.superseded,0) superseded,
  COALESCE(p.indeterminate,0) indeterminate,COALESCE(p.factCount,0) factCount,COALESCE(p.taskCount,0) taskCount,
  COALESCE(t.rawCount,0) rawCount,COALESCE(t.outsideWindow,0) outsideWindow,COALESCE(t.unsupported,0) unsupported,
  COALESCE(t.previouslyKnown,0) previouslyKnown,COALESCE(t.accepted,0) accepted,COALESCE(t.invalidPages,0) invalidPages
 FROM scans s LEFT JOIN progress p ON p.scan_id=s.id LEFT JOIN transport t ON t.scan_id=s.id ORDER BY s.scan_order DESC
 `).bind(user,workspace,epoch).all<Row>()).results;
 return rows.map(s=>{
  const sum=s.waiting+s.reserved+s.savedFacts+s.savedZeroFacts+s.legacySaved+s.superseded+s.indeterminate,repeated=s.rawCount-s.outsideWindow-s.unsupported-s.previouslyKnown-s.accepted;
  const interpretationProgress:HistoryInterpretationProgress={retained:s.retained,waiting:s.waiting,reserved:s.reserved,savedFacts:s.savedFacts,savedZeroFacts:s.savedZeroFacts,legacySaved:s.legacySaved,superseded:s.superseded,indeterminate:s.indeterminate,factCount:s.factCount,taskCount:s.taskCount,reconciled:sum===s.retained,observedAt:new Date(s.observed_at).toISOString()};
  const transport:HistoryTransportProgress={inspected:s.seen_count,outsideWindow:s.outsideWindow,unsupported:s.unsupported,previouslyKnown:s.previouslyKnown,retained:s.accepted,repeatedEntries:Math.max(0,repeated),reconciled:!s.invalidPages&&s.rawCount===s.seen_count&&repeated>=0&&s.accepted===s.retained};
  return {chatId:JSON.parse(s.authority_json).chatId,status:s.gap?'incomplete':s.status,reason:s.gap,window:{since:new Date(s.since).toISOString(),until:new Date(s.until).toISOString(),endExclusive:true},pages:s.page_count,inspectedMessages:s.seen_count,oldest:s.oldest===null?null:new Date(s.oldest).toISOString(),newest:s.newest===null?null:new Date(s.newest).toISOString(),interpretationProgress,transport,coverage:'Bounded provider history only. Saved counts record interpretation outcomes, not semantic completeness. Legacy decisions are unclassified; queued is not saved AI work.'};
 });
}
