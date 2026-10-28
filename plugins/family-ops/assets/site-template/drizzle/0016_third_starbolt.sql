ALTER TABLE `kids_hosted_batches` ADD `source_kind` text DEFAULT 'webhook' NOT NULL;--> statement-breakpoint
CREATE TRIGGER kids_history_scan_identity BEFORE UPDATE ON kids_hosted_history_scans
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.binding_id IS NOT OLD.binding_id OR NEW.chat_id IS NOT OLD.chat_id OR NEW.authority_hash IS NOT OLD.authority_hash OR NEW.authority_json IS NOT OLD.authority_json OR NEW.since IS NOT OLD.since OR NEW.until IS NOT OLD.until
 OR (NEW.revision<>OLD.revision AND NEW.revision<>OLD.revision+1)
 OR (NEW.revision=OLD.revision AND (NEW.page_count IS NOT OLD.page_count OR NEW.seen_count IS NOT OLD.seen_count OR NEW.cursor IS NOT OLD.cursor OR NEW.offset IS NOT OLD.offset OR NEW.total_count IS NOT OLD.total_count OR NEW.status IS NOT OLD.status OR NEW.oldest IS NOT OLD.oldest OR NEW.newest IS NOT OLD.newest))
 OR (NEW.revision=OLD.revision+1 AND (NEW.page_count<>OLD.page_count+1 OR NEW.seen_count<OLD.seen_count OR NOT EXISTS(SELECT 1 FROM kids_hosted_history_pages p WHERE p.scan_id=OLD.id AND p.scan_revision=OLD.revision AND p.status='committed' AND json_extract(p.result_json,'$.rawCount')=NEW.seen_count-OLD.seen_count)))
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_SCAN_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_page_identity BEFORE UPDATE ON kids_hosted_history_pages
WHEN OLD.status IN ('committed','noop') OR NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.request_hash IS NOT OLD.request_hash OR NEW.scan_id IS NOT OLD.scan_id OR NEW.scan_revision IS NOT OLD.scan_revision OR NEW.request_json IS NOT OLD.request_json OR NEW.webhook_watermark IS NOT OLD.webhook_watermark OR NEW.history_watermark IS NOT OLD.history_watermark OR NEW.created_at IS NOT OLD.created_at
 OR NEW.status NOT IN ('fetching','failed','committed') OR (NEW.status='committed' AND (NEW.response_hash IS NULL OR length(NEW.response_hash)<>64 OR NEW.result_json IS NULL OR NEW.fetched_at IS NULL OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_PAGE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_page_owner BEFORE INSERT ON kids_hosted_history_pages
WHEN NOT EXISTS(SELECT 1 FROM kids_hosted_history_scans s WHERE s.id=NEW.scan_id AND s.owner_user_id=NEW.owner_user_id AND s.workspace_id=NEW.workspace_id AND s.revision=NEW.scan_revision)
 OR EXISTS(SELECT 1 FROM kids_operation_receipts r WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM kids_hosted_batches b WHERE b.owner_user_id=NEW.owner_user_id AND b.workspace_id=NEW.workspace_id AND b.operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_READ_IDENTITY'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_message_identity BEFORE INSERT ON kids_hosted_history_messages
WHEN NEW.raw_body IS NULL OR NEW.consumed_at IS NOT NULL OR length(CAST(NEW.raw_body AS BLOB))<>NEW.raw_bytes OR length(NEW.body_hash)<>64 OR length(NEW.fingerprint)<>64
 OR NOT EXISTS(SELECT 1 FROM kids_hosted_history_pages p JOIN kids_hosted_history_scans s ON s.id=p.scan_id WHERE p.id=NEW.page_id AND p.status='fetching' AND p.response_hash IS NOT NULL AND p.lease_token IS NOT NULL AND p.lease_until>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND s.binding_id=NEW.binding_id AND s.chat_id=NEW.chat_id AND json_extract(s.authority_json,'$.bindingRevision')=NEW.binding_revision AND json_extract(s.authority_json,'$.epoch')=NEW.epoch AND json_extract(NEW.raw_body,'$.id')=NEW.message_id AND json_extract(NEW.raw_body,'$.chat_id')=NEW.chat_id)
 OR EXISTS(SELECT 1 FROM kids_hosted_events w WHERE w.binding_id=NEW.binding_id AND w.chat_id=NEW.chat_id AND w.message_id=NEW.message_id)
 OR EXISTS(SELECT 1 FROM kids_hosted_message_heads w WHERE w.binding_id=NEW.binding_id AND w.chat_id=NEW.chat_id AND w.message_id=NEW.message_id)
 OR EXISTS(SELECT 1 FROM kids_hosted_history_heads w WHERE w.binding_id=NEW.binding_id AND w.chat_id=NEW.chat_id AND w.message_id=NEW.message_id)
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_MESSAGE_IDENTITY'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_message_immutable BEFORE UPDATE ON kids_hosted_history_messages
WHEN NEW.sequence IS NOT OLD.sequence OR NEW.page_id IS NOT OLD.page_id OR NEW.binding_id IS NOT OLD.binding_id OR NEW.binding_revision IS NOT OLD.binding_revision OR NEW.epoch IS NOT OLD.epoch OR NEW.chat_id IS NOT OLD.chat_id OR NEW.message_id IS NOT OLD.message_id OR NEW.body_hash IS NOT OLD.body_hash OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.message_millis IS NOT OLD.message_millis
 OR NOT(OLD.raw_body IS NOT NULL AND OLD.consumed_at IS NULL AND NEW.raw_body IS NULL AND NEW.raw_bytes=0 AND NEW.consumed_at IS NOT NULL AND (EXISTS(SELECT 1 FROM kids_hosted_history_heads h WHERE h.binding_id=OLD.binding_id AND h.chat_id=OLD.chat_id AND h.message_id=OLD.message_id AND h.message_sequence=OLD.sequence AND h.body_hash=OLD.body_hash AND h.fingerprint=OLD.fingerprint) OR EXISTS(SELECT 1 FROM kids_hosted_bindings b JOIN kids_hosted_removals r ON r.owner_user_id=b.owner_user_id AND r.workspace_id=b.workspace_id,json_each(r.bindings_json) x WHERE b.id=OLD.binding_id AND b.active=0 AND b.removed_at IS NOT NULL AND r.status='completed' AND json_extract(x.value,'$.id')=b.id)))
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_MESSAGE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_member_identity BEFORE INSERT ON kids_hosted_history_batch_members
WHEN (SELECT COUNT(*) FROM kids_hosted_history_batch_members WHERE batch_id=NEW.batch_id)>=10 OR NOT EXISTS(SELECT 1 FROM kids_hosted_batches b JOIN kids_hosted_history_messages m ON m.sequence=NEW.message_sequence JOIN kids_hosted_history_pages p ON p.id=m.page_id WHERE b.id=NEW.batch_id AND b.source_kind='history' AND b.status='ready' AND p.status='committed' AND p.response_hash IS NOT NULL AND p.owner_user_id=b.owner_user_id AND p.workspace_id=b.workspace_id AND m.binding_id=b.binding_id AND m.binding_revision=b.binding_revision AND m.epoch=b.epoch AND m.chat_id=b.chat_id AND m.chat_id=NEW.chat_id AND m.message_id=NEW.message_id AND m.body_hash=NEW.body_hash AND m.fingerprint=NEW.fingerprint AND m.raw_body IS NOT NULL AND m.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_MEMBER_IDENTITY'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_member_immutable BEFORE UPDATE ON kids_hosted_history_batch_members
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_MEMBER_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_head_identity BEFORE INSERT ON kids_hosted_history_heads
WHEN NOT EXISTS(SELECT 1 FROM kids_hosted_history_messages m JOIN kids_hosted_history_batch_members x ON x.message_sequence=m.sequence JOIN kids_hosted_batches b ON b.id=x.batch_id WHERE m.sequence=NEW.message_sequence AND m.binding_id=NEW.binding_id AND m.chat_id=NEW.chat_id AND m.message_id=NEW.message_id AND m.body_hash=NEW.body_hash AND m.fingerprint=NEW.fingerprint AND b.status='saved' AND b.source_kind='history')
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_HEAD_IDENTITY'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_head_immutable BEFORE UPDATE ON kids_hosted_history_heads
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_HEAD_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_batch_origin BEFORE UPDATE ON kids_hosted_batches WHEN NEW.source_kind IS NOT OLD.source_kind
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_BATCH_ORIGIN_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_webhook_member_origin BEFORE INSERT ON kids_hosted_batch_members
WHEN NOT EXISTS(SELECT 1 FROM kids_hosted_batches b WHERE b.id=NEW.batch_id AND b.source_kind='webhook')
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_MEMBER_ORIGIN'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_batch_read BEFORE INSERT ON kids_hosted_batches
WHEN NEW.source_kind NOT IN ('webhook','history') OR EXISTS(SELECT 1 FROM kids_hosted_history_pages p WHERE p.owner_user_id=NEW.owner_user_id AND p.workspace_id=NEW.workspace_id AND p.operation_id=NEW.operation_id AND (NEW.source_kind<>'history' OR p.status<>'committed' OR p.request_hash<>NEW.request_hash))
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_READ_IDENTITY'); END;
--> statement-breakpoint
CREATE TRIGGER kids_source_read_receipt_guard BEFORE INSERT ON kids_operation_receipts
WHEN (EXISTS(SELECT 1 FROM kids_hosted_history_pages p WHERE p.owner_user_id=NEW.owner_user_id AND p.workspace_id=NEW.workspace_id AND p.operation_id=NEW.operation_id) OR EXISTS(SELECT 1 FROM kids_hosted_batches b WHERE b.owner_user_id=NEW.owner_user_id AND b.workspace_id=NEW.workspace_id AND b.operation_id=NEW.operation_id))
 AND NOT EXISTS(SELECT 1 FROM kids_hosted_batches b WHERE b.owner_user_id=NEW.owner_user_id AND b.workspace_id=NEW.workspace_id AND b.operation_id=NEW.operation_id AND b.status='ready' AND json_extract(NEW.source_authority,'$.kind')='hosted-source-batch-v1' AND json_extract(NEW.source_authority,'$.batchId')=b.id)
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_READ_OPERATION_RESERVED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_message_delete BEFORE DELETE ON kids_hosted_history_messages
WHEN EXISTS(SELECT 1 FROM kids_hosted_bindings b JOIN kids_state k ON k.user_id=b.owner_user_id AND k.id=b.workspace_id WHERE b.id=OLD.binding_id)
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_MESSAGE_RECEIPT_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_history_page_delete BEFORE DELETE ON kids_hosted_history_pages
WHEN EXISTS(SELECT 1 FROM kids_state k WHERE k.user_id=OLD.owner_user_id AND k.id=OLD.workspace_id)
BEGIN SELECT RAISE(ABORT,'KIDS_HISTORY_PAGE_RECEIPT_REQUIRED'); END;
