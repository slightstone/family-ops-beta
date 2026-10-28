CREATE TABLE `kids_hosted_batch_members` (
	`batch_id` text NOT NULL,
	`event_sequence` integer NOT NULL,
	`body_hash` text NOT NULL,
	`fingerprint` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`event_millis` integer NOT NULL,
	PRIMARY KEY(`batch_id`, `event_sequence`),
	FOREIGN KEY (`batch_id`) REFERENCES `kids_hosted_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_sequence`) REFERENCES `kids_hosted_events`(`sequence`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_batch_message` ON `kids_hosted_batch_members` (`batch_id`,`chat_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `kids_hosted_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`binding_id` text NOT NULL,
	`binding_revision` integer NOT NULL,
	`config_hash` text NOT NULL,
	`epoch` integer NOT NULL,
	`service_grant_id` text NOT NULL,
	`service_revision` integer NOT NULL,
	`chat_id` text NOT NULL,
	`child_id` text NOT NULL,
	`topic` text NOT NULL,
	`workspace_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`submitted_hash` text,
	`committed_revision` integer,
	FOREIGN KEY (`binding_id`) REFERENCES `kids_hosted_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_hosted_batch_status" CHECK("kids_hosted_batches"."status" IN ('ready','saved','superseded')),
	CONSTRAINT "kids_hosted_batch_clock" CHECK("kids_hosted_batches"."created_at">=0 AND "kids_hosted_batches"."expires_at"="kids_hosted_batches"."created_at"+600000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_batch_operation` ON `kids_hosted_batches` (`owner_user_id`,`workspace_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `kids_hosted_batch_chat_lease` ON `kids_hosted_batches` (`owner_user_id`,`workspace_id`,`chat_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `kids_hosted_message_heads` (
	`binding_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`event_millis` integer NOT NULL,
	`event_sequence` integer NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`binding_id`, `chat_id`, `message_id`),
	FOREIGN KEY (`binding_id`) REFERENCES `kids_hosted_bindings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `kids_hosted_events` ADD `event_millis` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `kids_hosted_events` ADD `consumed_at` integer;--> statement-breakpoint
DROP TRIGGER kids_hosted_event_immutable;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_event_immutable BEFORE UPDATE ON kids_hosted_events
WHEN NEW.sequence IS NOT OLD.sequence OR NEW.binding_id IS NOT OLD.binding_id
 OR NEW.binding_revision IS NOT OLD.binding_revision OR NEW.application_id IS NOT OLD.application_id
 OR NEW.event_id IS NOT OLD.event_id OR NEW.event_type IS NOT OLD.event_type
 OR NEW.event_created_at IS NOT OLD.event_created_at OR NEW.event_millis IS NOT OLD.event_millis
 OR NEW.chat_id IS NOT OLD.chat_id OR NEW.message_id IS NOT OLD.message_id OR NEW.body_hash IS NOT OLD.body_hash
 OR NEW.workspace_revision IS NOT OLD.workspace_revision OR NEW.epoch IS NOT OLD.epoch
 OR NEW.service_grant_id IS NOT OLD.service_grant_id OR NEW.service_revision IS NOT OLD.service_revision
 OR NEW.received_at IS NOT OLD.received_at
 OR NOT(OLD.consumed_at IS NULL AND OLD.raw_body IS NOT NULL AND NEW.consumed_at IS NOT NULL
   AND NEW.raw_body IS NULL AND NEW.raw_bytes=0
   AND EXISTS(SELECT 1 FROM kids_hosted_message_heads h
     WHERE h.binding_id=OLD.binding_id AND h.chat_id=OLD.chat_id AND h.message_id=OLD.message_id
       AND (h.event_millis>OLD.event_millis OR h.event_millis=OLD.event_millis AND h.event_sequence>=OLD.sequence)))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_batch_member_identity BEFORE INSERT ON kids_hosted_batch_members
WHEN (SELECT COUNT(*) FROM kids_hosted_batch_members WHERE batch_id=NEW.batch_id)>=10 OR NOT EXISTS(SELECT 1 FROM kids_hosted_batches b JOIN kids_hosted_events e ON e.sequence=NEW.event_sequence
 WHERE b.id=NEW.batch_id AND b.status='ready' AND e.binding_id=b.binding_id
 AND e.binding_revision=b.binding_revision AND e.epoch=b.epoch AND e.chat_id=b.chat_id
 AND e.chat_id=NEW.chat_id AND e.message_id=NEW.message_id AND e.body_hash=NEW.body_hash
 AND e.event_millis=NEW.event_millis AND e.event_millis>0 AND e.raw_body IS NOT NULL AND e.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_MEMBER_IDENTITY'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_batch_member_immutable BEFORE UPDATE ON kids_hosted_batch_members
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_MEMBER_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_batch_identity BEFORE UPDATE ON kids_hosted_batches
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.operation_id IS NOT OLD.operation_id OR NEW.request_hash IS NOT OLD.request_hash
 OR NEW.binding_id IS NOT OLD.binding_id OR NEW.binding_revision IS NOT OLD.binding_revision OR NEW.config_hash IS NOT OLD.config_hash
 OR NEW.epoch IS NOT OLD.epoch OR NEW.service_grant_id IS NOT OLD.service_grant_id OR NEW.service_revision IS NOT OLD.service_revision
 OR NEW.chat_id IS NOT OLD.chat_id OR NEW.child_id IS NOT OLD.child_id OR NEW.topic IS NOT OLD.topic
 OR NEW.workspace_revision IS NOT OLD.workspace_revision OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR OLD.status<>'ready' OR NEW.status NOT IN ('saved','superseded')
 OR (NEW.status='saved' AND (NEW.submitted_hash IS NULL OR NEW.committed_revision IS NULL))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_BATCH_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_head_order BEFORE UPDATE ON kids_hosted_message_heads
WHEN NEW.binding_id IS NOT OLD.binding_id OR NEW.chat_id IS NOT OLD.chat_id OR NEW.message_id IS NOT OLD.message_id
 OR NEW.event_millis<OLD.event_millis OR NEW.event_millis=OLD.event_millis AND NEW.event_sequence<=OLD.event_sequence
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_HEAD_ORDER'); END;
