CREATE TABLE kids_source_proposals (
 owner_user_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 proposal_id TEXT NOT NULL,
 stage_operation_id TEXT NOT NULL,
 stage_hash TEXT NOT NULL,
 effect_operation_id TEXT NOT NULL,
 effect_hash TEXT,
 proposal_hash TEXT NOT NULL,
 approval_digest TEXT NOT NULL,
 base_revision INTEGER NOT NULL CHECK(base_revision>0),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 context_json TEXT NOT NULL CHECK(json_valid(context_json)),
 preview_json TEXT NOT NULL CHECK(json_valid(preview_json)),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','approved','cancelled')),
 approved_at INTEGER,
 cancelled_at INTEGER,
 PRIMARY KEY(owner_user_id,proposal_id),
 UNIQUE(owner_user_id,stage_operation_id),
 UNIQUE(owner_user_id,effect_operation_id),
 CHECK(proposal_id<>stage_operation_id AND proposal_id<>effect_operation_id AND stage_operation_id<>effect_operation_id),
 CHECK((status='staged' AND approved_at IS NULL AND cancelled_at IS NULL) OR (status='approved' AND approved_at IS NOT NULL AND cancelled_at IS NULL) OR (status='cancelled' AND approved_at IS NULL AND cancelled_at IS NOT NULL)),
 FOREIGN KEY(owner_user_id,workspace_id) REFERENCES kids_state(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER kids_source_proposal_immutable BEFORE UPDATE ON kids_source_proposals
WHEN NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.proposal_id IS NOT OLD.proposal_id
 OR NEW.stage_operation_id IS NOT OLD.stage_operation_id OR NEW.stage_hash IS NOT OLD.stage_hash OR NEW.effect_operation_id IS NOT OLD.effect_operation_id
 OR NEW.effect_hash IS NOT OLD.effect_hash OR NEW.proposal_hash IS NOT OLD.proposal_hash OR NEW.approval_digest IS NOT OLD.approval_digest OR NEW.base_revision IS NOT OLD.base_revision
 OR NEW.payload_json IS NOT OLD.payload_json OR NEW.context_json IS NOT OLD.context_json OR NEW.preview_json IS NOT OLD.preview_json
 OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.status<>'staged' OR NEW.status NOT IN ('approved','cancelled')
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_PROPOSAL_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_source_receipt_namespace BEFORE INSERT ON kids_operation_receipts
WHEN EXISTS(SELECT 1 FROM kids_source_proposals p WHERE p.owner_user_id=NEW.owner_user_id AND (p.proposal_id=NEW.operation_id OR p.stage_operation_id=NEW.operation_id OR p.effect_operation_id=NEW.operation_id AND (p.status<>'approved' OR p.workspace_id<>NEW.workspace_id OR json_extract(p.payload_json,'$.kind') NOT IN ('board','prepare','removal') OR p.effect_hash IS NOT NEW.body_hash)))
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_OPERATION_RESERVED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_source_auth_namespace BEFORE INSERT ON kids_hosted_auth
WHEN EXISTS(SELECT 1 FROM kids_source_proposals p WHERE p.owner_user_id=NEW.owner_user_id AND (p.proposal_id=NEW.operation_id OR p.stage_operation_id=NEW.operation_id OR p.effect_operation_id=NEW.operation_id AND (p.status<>'approved' OR p.workspace_id<>NEW.workspace_id OR json_extract(p.payload_json,'$.kind')<>'auth' OR NEW.workspace_revision<>p.base_revision OR (json_extract(p.payload_json,'$.change.action')='check-paired' AND NEW.recovery_of IS NOT json_extract(p.payload_json,'$.change.setupId')) OR (json_extract(p.payload_json,'$.change.action')<>'check-paired' AND (NEW.intent IS NOT json_extract(p.payload_json,'$.command.intent') OR (json_extract(p.payload_json,'$.command.connectionId') IS NOT NULL AND (NEW.slot_id IS NOT json_extract(p.payload_json,'$.command.connectionId') OR NEW.slot_revision IS NOT json_extract(p.payload_json,'$.command.connectionRevision') OR NEW.slot_epoch IS NOT json_extract(p.payload_json,'$.command.sourceEpoch'))))))))
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_OPERATION_RESERVED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_source_removal_namespace BEFORE INSERT ON kids_hosted_removals
WHEN EXISTS(SELECT 1 FROM kids_source_proposals p WHERE p.owner_user_id=NEW.owner_user_id AND (p.proposal_id=NEW.operation_id OR p.stage_operation_id=NEW.operation_id OR p.effect_operation_id=NEW.operation_id AND (p.status<>'approved' OR p.workspace_id<>NEW.workspace_id OR json_extract(p.payload_json,'$.kind')<>'removal' OR p.effect_hash IS NOT NEW.body_hash OR NEW.target_connection_id IS NOT json_extract(p.payload_json,'$.command.connection.id'))))
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_OPERATION_RESERVED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_source_batch_namespace BEFORE INSERT ON kids_hosted_batches
WHEN EXISTS(SELECT 1 FROM kids_source_proposals p WHERE p.owner_user_id=NEW.owner_user_id AND NEW.operation_id IN (p.proposal_id,p.stage_operation_id,p.effect_operation_id))
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_OPERATION_RESERVED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_source_history_namespace BEFORE INSERT ON kids_hosted_history_pages
WHEN EXISTS(SELECT 1 FROM kids_source_proposals p WHERE p.owner_user_id=NEW.owner_user_id AND NEW.operation_id IN (p.proposal_id,p.stage_operation_id,p.effect_operation_id))
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_OPERATION_RESERVED'); END;
