-- Host-save outcomes share the existing immutable receipt; no historical backfill.
DROP TRIGGER kids_source_read_receipt_guard;
--> statement-breakpoint
CREATE TRIGGER kids_source_read_receipt_guard BEFORE INSERT ON kids_operation_receipts
WHEN (EXISTS(SELECT 1 FROM kids_hosted_history_pages p WHERE p.owner_user_id=NEW.owner_user_id AND p.workspace_id=NEW.workspace_id AND p.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM kids_hosted_batches b WHERE b.owner_user_id=NEW.owner_user_id AND b.workspace_id=NEW.workspace_id AND b.operation_id=NEW.operation_id)
 OR CASE WHEN json_valid(NEW.source_authority) THEN json_extract(NEW.source_authority,'$.kind')='hosted-source-batch-v1' ELSE 0 END)
 AND NOT EXISTS(SELECT 1 FROM kids_hosted_batches b JOIN kids_state k ON k.user_id=b.owner_user_id AND k.id=b.workspace_id
 WHERE b.owner_user_id=NEW.owner_user_id AND b.workspace_id=NEW.workspace_id AND b.operation_id=NEW.operation_id AND b.status='saved'
 AND NEW.body_hash=b.submitted_hash AND NEW.committed_revision=b.committed_revision AND NEW.committed_revision=k.revision
 AND CASE WHEN json_valid(NEW.source_authority) THEN json_extract(NEW.source_authority,'$.kind')='hosted-source-batch-v1' ELSE 0 END AND json_extract(CASE WHEN json_valid(NEW.source_authority) THEN NEW.source_authority ELSE '{}' END,'$.batchId')=b.id
 AND json_extract(CASE WHEN json_valid(NEW.source_authority) THEN NEW.source_authority ELSE '{}' END,'$.bindingId')=b.binding_id AND json_extract(CASE WHEN json_valid(NEW.source_authority) THEN NEW.source_authority ELSE '{}' END,'$.bindingRevision')=b.binding_revision AND json_extract(CASE WHEN json_valid(NEW.source_authority) THEN NEW.source_authority ELSE '{}' END,'$.epoch')=b.epoch
 AND json_extract(CASE WHEN json_valid(NEW.source_authority) THEN NEW.source_authority ELSE '{}' END,'$.sourceKind')=b.source_kind AND CASE WHEN json_valid(NEW.source_authority) THEN (json_type(NEW.source_authority,'$.outcomeVersion')='integer' AND json_extract(NEW.source_authority,'$.outcomeVersion')=1
 AND json_type(NEW.source_authority,'$.outcomes')='array'
 AND json_array_length(NEW.source_authority,'$.outcomes') BETWEEN 1 AND 10
 AND json_array_length(NEW.source_authority,'$.outcomes')=CASE b.source_kind WHEN 'history' THEN (SELECT COUNT(*) FROM kids_hosted_history_batch_members m WHERE m.batch_id=b.id) WHEN 'webhook' THEN (SELECT COUNT(*) FROM kids_hosted_batch_members m WHERE m.batch_id=b.id) ELSE -1 END
 AND (SELECT COUNT(DISTINCT json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.id')) FROM json_each(NEW.source_authority,'$.outcomes') o)=json_array_length(NEW.source_authority,'$.outcomes')
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.source_authority,'$.outcomes') o WHERE
 o.type<>'object' OR COALESCE(json_type(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.id'),'')<>'text' OR COALESCE(json_type(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.fingerprint'),'')<>'text'
 OR COALESCE(json_type(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.factCount'),'')<>'integer' OR COALESCE(json_type(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.taskCount'),'')<>'integer'
 OR json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.factCount') NOT BETWEEN 0 AND 8 OR json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.taskCount') NOT BETWEEN 0 AND 240
 OR (json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.factCount')=0 AND json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.taskCount')<>0) OR NOT ((b.source_kind='history' AND EXISTS(SELECT 1 FROM kids_hosted_history_batch_members m WHERE m.batch_id=b.id AND m.message_id=json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.id') AND m.fingerprint=json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.fingerprint'))) OR (b.source_kind='webhook' AND EXISTS(SELECT 1 FROM kids_hosted_batch_members m WHERE m.batch_id=b.id AND m.message_id=json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.id') AND m.fingerprint=json_extract(CASE WHEN o.type='object' THEN o.value ELSE '{}' END,'$.fingerprint')))))) ELSE 0 END)
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_OUTCOME_RECEIPT_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_receipt_delete_guard BEFORE DELETE ON kids_operation_receipts
WHEN CASE WHEN json_valid(OLD.source_authority) THEN json_extract(OLD.source_authority,'$.kind')='hosted-source-batch-v1' ELSE 0 END
 AND EXISTS(SELECT 1 FROM kids_state k WHERE k.user_id=OLD.owner_user_id AND k.id=OLD.workspace_id)
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_OUTCOME_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE INDEX kids_history_page_scan ON kids_hosted_history_pages(scan_id,status);
--> statement-breakpoint
CREATE INDEX kids_history_member_message ON kids_hosted_history_batch_members(message_sequence,batch_id);
