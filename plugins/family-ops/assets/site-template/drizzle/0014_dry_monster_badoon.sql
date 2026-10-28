CREATE TABLE `kids_hosted_removal_targets` (
	`owner_user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`account_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`identity_hash` text NOT NULL,
	`verified_at` integer NOT NULL,
	`delete_attempts` integer DEFAULT 0 NOT NULL,
	`absent_at` integer,
	PRIMARY KEY(`owner_user_id`, `operation_id`, `account_id`),
	FOREIGN KEY (`owner_user_id`,`operation_id`) REFERENCES `kids_hosted_removals`(`owner_user_id`,`operation_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kids_hosted_removals` (
	`owner_user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`body_hash` text NOT NULL,
	`config_hash` text NOT NULL,
	`application_id` text NOT NULL,
	`production` integer NOT NULL,
	`endpoint_id` text NOT NULL,
	`original_revision` integer NOT NULL,
	`paused_revision` integer NOT NULL,
	`paused_epoch` integer NOT NULL,
	`auth_cutoff` integer NOT NULL,
	`bindings_json` text NOT NULL,
	`scopes_json` text NOT NULL,
	`wait_until` integer NOT NULL,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`next_check_at` integer,
	`completed_at` integer,
	`proof_json` text,
	PRIMARY KEY(`owner_user_id`, `operation_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_hosted_removal_status" CHECK("kids_hosted_removals"."status" IN ('pending','waiting','checking','unknown','completed')),
	CONSTRAINT "kids_hosted_removal_revision" CHECK("kids_hosted_removals"."paused_revision"="kids_hosted_removals"."original_revision"+1 AND "kids_hosted_removals"."auth_cutoff">=0 AND "kids_hosted_removals"."created_at">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_removal_pending` ON `kids_hosted_removals` (`owner_user_id`,`workspace_id`) WHERE "kids_hosted_removals"."status"<>'completed';--> statement-breakpoint
DROP INDEX `kids_hosted_scope`;--> statement-breakpoint
ALTER TABLE `kids_hosted_bindings` ADD `removed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_scope` ON `kids_hosted_bindings` (`application_id`,`scope_id`) WHERE "kids_hosted_bindings"."removed_at" IS NULL;--> statement-breakpoint
-- Removal closes setup races without relaxing immutable connected auth rows.
CREATE TRIGGER kids_hosted_auth_removal_insert BEFORE INSERT ON kids_hosted_auth
WHEN EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.status<>'completed')
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_REMOVAL_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_auth_removal_complete BEFORE UPDATE OF status ON kids_hosted_auth
WHEN NEW.status='connected' AND EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND (r.status<>'completed' OR OLD.rowid<=r.auth_cutoff))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_REMOVAL_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_binding_removal_insert BEFORE INSERT ON kids_hosted_bindings
WHEN EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.status<>'completed')
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_REMOVAL_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_binding_removed BEFORE UPDATE ON kids_hosted_bindings
WHEN (OLD.removed_at IS NOT NULL AND (NEW.removed_at IS NOT OLD.removed_at OR NEW.active<>0))
 OR (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL AND (NEW.active<>0 OR NOT EXISTS(SELECT 1 FROM kids_hosted_removals r,json_each(r.bindings_json) b WHERE r.owner_user_id=OLD.owner_user_id AND r.workspace_id=OLD.workspace_id AND r.status='completed' AND r.completed_at=NEW.removed_at AND json_extract(b.value,'$.id')=OLD.id AND json_extract(b.value,'$.revision')+1=OLD.revision)))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_REMOVAL_UNCONFIRMED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_removal_identity BEFORE UPDATE ON kids_hosted_removals
WHEN OLD.status='completed' OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.body_hash IS NOT OLD.body_hash OR NEW.config_hash IS NOT OLD.config_hash OR NEW.application_id IS NOT OLD.application_id OR NEW.production IS NOT OLD.production OR NEW.endpoint_id IS NOT OLD.endpoint_id
 OR NEW.original_revision IS NOT OLD.original_revision OR NEW.paused_revision IS NOT OLD.paused_revision OR NEW.paused_epoch IS NOT OLD.paused_epoch OR NEW.auth_cutoff IS NOT OLD.auth_cutoff OR NEW.bindings_json IS NOT OLD.bindings_json OR NEW.scopes_json IS NOT OLD.scopes_json OR NEW.wait_until IS NOT OLD.wait_until OR NEW.created_at IS NOT OLD.created_at
 OR (NEW.status='completed' AND (OLD.status<>'checking' OR NEW.completed_at IS NULL OR NEW.proof_json IS NULL OR json_valid(NEW.proof_json)=0 OR json_extract(NEW.proof_json,'$.zeroAccounts')<>1))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_REMOVAL_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_removal_target_identity BEFORE UPDATE ON kids_hosted_removal_targets
WHEN NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.account_id IS NOT OLD.account_id OR NEW.scope_id IS NOT OLD.scope_id OR NEW.identity_hash IS NOT OLD.identity_hash OR NEW.verified_at<OLD.verified_at OR NEW.delete_attempts<OLD.delete_attempts
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_REMOVAL_TARGET_IMMUTABLE'); END;
--> statement-breakpoint
DROP TRIGGER kids_hosted_unlink_before_delete;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_unlink_before_delete BEFORE DELETE ON kids_state
WHEN EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.owner_user_id=OLD.user_id AND b.workspace_id=OLD.id AND b.removed_at IS NULL)
 OR EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=OLD.user_id AND r.workspace_id=OLD.id AND r.status<>'completed')
 OR EXISTS(SELECT 1 FROM kids_hosted_auth a WHERE a.owner_user_id=OLD.user_id AND a.workspace_id=OLD.id AND NOT EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=OLD.user_id AND r.workspace_id=OLD.id AND r.status='completed' AND r.auth_cutoff>=a.rowid))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_UNLINK_FIRST'); END;
--> statement-breakpoint
DROP TRIGGER kids_hosted_event_immutable;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_event_immutable BEFORE UPDATE ON kids_hosted_events
WHEN NEW.sequence IS NOT OLD.sequence OR NEW.binding_id IS NOT OLD.binding_id OR NEW.binding_revision IS NOT OLD.binding_revision OR NEW.application_id IS NOT OLD.application_id
 OR NEW.event_id IS NOT OLD.event_id OR NEW.event_type IS NOT OLD.event_type OR NEW.event_created_at IS NOT OLD.event_created_at OR NEW.event_millis IS NOT OLD.event_millis
 OR NEW.chat_id IS NOT OLD.chat_id OR NEW.message_id IS NOT OLD.message_id OR NEW.body_hash IS NOT OLD.body_hash OR NEW.workspace_revision IS NOT OLD.workspace_revision OR NEW.epoch IS NOT OLD.epoch
 OR NEW.service_grant_id IS NOT OLD.service_grant_id OR NEW.service_revision IS NOT OLD.service_revision OR NEW.received_at IS NOT OLD.received_at
 OR NOT(OLD.consumed_at IS NULL AND OLD.raw_body IS NOT NULL AND NEW.consumed_at IS NOT NULL AND NEW.raw_body IS NULL AND NEW.raw_bytes=0 AND (
 EXISTS(SELECT 1 FROM kids_hosted_message_heads h WHERE h.binding_id=OLD.binding_id AND h.chat_id=OLD.chat_id AND h.message_id=OLD.message_id AND (h.event_millis>OLD.event_millis OR h.event_millis=OLD.event_millis AND h.event_sequence>=OLD.sequence))
 OR EXISTS(SELECT 1 FROM kids_hosted_bindings b JOIN kids_hosted_removals r ON r.owner_user_id=b.owner_user_id AND r.workspace_id=b.workspace_id,json_each(r.bindings_json) x WHERE b.id=OLD.binding_id AND b.active=0 AND b.removed_at IS NOT NULL AND r.status='completed' AND json_extract(x.value,'$.id')=b.id)))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_EVENT_IMMUTABLE'); END;

--> statement-breakpoint
-- Retain the historical binding as the receipt anchor until the separately
-- confirmed, provider-proved Kids workspace deletion actually cascades.
CREATE TRIGGER kids_hosted_binding_delete_guard BEFORE DELETE ON kids_hosted_bindings
WHEN EXISTS(SELECT 1 FROM kids_state k WHERE k.user_id=OLD.owner_user_id AND k.id=OLD.workspace_id)
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_BINDING_HISTORY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_event_delete_guard BEFORE DELETE ON kids_hosted_events
WHEN EXISTS(SELECT 1 FROM kids_hosted_bindings b JOIN kids_state k ON k.user_id=b.owner_user_id AND k.id=b.workspace_id WHERE b.id=OLD.binding_id)
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_EVENT_RECEIPT_REQUIRED'); END;
