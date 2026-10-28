CREATE TABLE `kids_hosted_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`application_id` text NOT NULL,
	`production` integer NOT NULL,
	`endpoint_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`account_id` text NOT NULL,
	`revision` integer NOT NULL,
	`active` integer NOT NULL,
	`consent_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`reconciliation_reason` text,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_hosted_binding_flags" CHECK("kids_hosted_bindings"."production" IN (0,1) AND "kids_hosted_bindings"."active" IN (0,1) AND "kids_hosted_bindings"."revision">=1 AND "kids_hosted_bindings"."created_at">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_account` ON `kids_hosted_bindings` (`application_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_scope` ON `kids_hosted_bindings` (`application_id`,`scope_id`);--> statement-breakpoint
CREATE TABLE `kids_hosted_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`binding_id` text NOT NULL,
	`binding_revision` integer NOT NULL,
	`application_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_created_at` text NOT NULL,
	`chat_id` text,
	`message_id` text,
	`body_hash` text NOT NULL,
	`raw_body` text,
	`raw_bytes` integer NOT NULL,
	`workspace_revision` integer NOT NULL,
	`epoch` integer NOT NULL,
	`service_grant_id` text NOT NULL,
	`service_revision` integer NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `kids_hosted_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_hosted_event_size" CHECK("kids_hosted_events"."raw_bytes">=0 AND "kids_hosted_events"."raw_bytes"<=262144)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_event_identity` ON `kids_hosted_events` (`application_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `kids_hosted_event_queue` ON `kids_hosted_events` (`binding_id`,`sequence`);--> statement-breakpoint
CREATE TRIGGER kids_hosted_event_immutable BEFORE UPDATE ON kids_hosted_events
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_EVENT_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER kids_hosted_binding_identity BEFORE UPDATE ON kids_hosted_bindings
WHEN NEW.id<>OLD.id OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.workspace_id<>OLD.workspace_id
 OR NEW.application_id<>OLD.application_id OR NEW.production<>OLD.production OR NEW.endpoint_id<>OLD.endpoint_id
 OR NEW.scope_id<>OLD.scope_id OR NEW.account_id<>OLD.account_id OR NEW.created_at<>OLD.created_at
 OR NEW.consent_version<>OLD.consent_version OR NEW.revision<OLD.revision
 OR (NEW.active<>OLD.active AND NEW.revision<=OLD.revision)
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_BINDING_IMMUTABLE'); END;
