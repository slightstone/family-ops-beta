-- Schema only. The first unique-index build fails closed on legacy tuple duplicates.
CREATE UNIQUE INDEX `kids_source_message_identity` ON `kids_source_records` (`owner_user_id`,`workspace_id`,`chat_id`,`message_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_binding_owner` ON `kids_hosted_bindings` (`owner_user_id`,`workspace_id`,`id`);
--> statement-breakpoint
CREATE TABLE `kids_source_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`slot_number` integer NOT NULL,
	`binding_id` text,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`source_epoch` integer NOT NULL,
	`discovery_consent` integer NOT NULL,
	`processing_consent` integer NOT NULL,
	`confirmed_at` text,
	`paused` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`workspace_id`,`binding_id`) REFERENCES `kids_hosted_bindings`(`owner_user_id`,`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kids_source_connection_shape" CHECK("kids_source_connections"."slot_number" IN (1,2) AND "kids_source_connections"."status" IN ('reserved','connected','removed') AND "kids_source_connections"."revision">=1 AND "kids_source_connections"."source_epoch">=0 AND "kids_source_connections"."discovery_consent" IN (0,1) AND "kids_source_connections"."processing_consent" IN (0,1) AND "kids_source_connections"."paused" IN (0,1) AND length("kids_source_connections"."label") BETWEEN 1 AND 80 AND ("kids_source_connections"."binding_id" IS NULL OR "kids_source_connections"."binding_id"="kids_source_connections"."id") AND ("kids_source_connections"."status"<>'connected' OR "kids_source_connections"."binding_id" IS NOT NULL) AND ("kids_source_connections"."processing_consent"=0 OR ("kids_source_connections"."discovery_consent"=1 AND "kids_source_connections"."confirmed_at" IS NOT NULL AND "kids_source_connections"."paused"=0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_source_connection_slot` ON `kids_source_connections` (`owner_user_id`,`workspace_id`,`slot_number`) WHERE "kids_source_connections"."status"<>'removed';
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_source_connection_binding` ON `kids_source_connections` (`binding_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_source_connection_owner_binding` ON `kids_source_connections` (`owner_user_id`,`workspace_id`,`binding_id`);
--> statement-breakpoint
CREATE TABLE `kids_chat_sources` (
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`app_chat_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`provider_chat_id` text NOT NULL,
	`identity_kind` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_user_id`, `workspace_id`, `app_chat_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`workspace_id`,`binding_id`) REFERENCES `kids_source_connections`(`owner_user_id`,`workspace_id`,`binding_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kids_chat_source_identity" CHECK(length("kids_chat_sources"."app_chat_id") BETWEEN 1 AND 180 AND length("kids_chat_sources"."provider_chat_id") BETWEEN 1 AND 180 AND "kids_chat_sources"."identity_kind" IN ('legacy','namespaced') AND "kids_chat_sources"."created_at">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_chat_provider_identity` ON `kids_chat_sources` (`binding_id`,`provider_chat_id`);
--> statement-breakpoint
CREATE TRIGGER kids_source_connection_immutable BEFORE UPDATE ON kids_source_connections
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.slot_number IS NOT OLD.slot_number OR (OLD.binding_id IS NOT NULL AND NEW.binding_id IS NOT OLD.binding_id) OR (OLD.status='removed' AND NEW.status<>'removed')
BEGIN SELECT RAISE(ABORT,'KIDS_CONNECTION_IDENTITY_CHANGED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_chat_source_immutable BEFORE UPDATE ON kids_chat_sources
BEGIN SELECT RAISE(ABORT,'KIDS_CHAT_IDENTITY_CHANGED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_chat_source_preserve BEFORE DELETE ON kids_chat_sources
WHEN EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id)
BEGIN SELECT RAISE(ABORT,'KIDS_CHAT_IDENTITY_RETAINED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_saved_source_identity BEFORE UPDATE ON kids_source_records
WHEN NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.source_key IS NOT OLD.source_key OR NEW.message_id IS NOT OLD.message_id OR NEW.chat_id IS NOT OLD.chat_id
BEGIN SELECT RAISE(ABORT,'KIDS_SAVED_SOURCE_IDENTITY_CHANGED'); END;
