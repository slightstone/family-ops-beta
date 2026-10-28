CREATE TABLE `kids_google_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`link_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`account_label` text NOT NULL,
	`calendar_label` text NOT NULL,
	`child_ids_json` text NOT NULL,
	`role` text NOT NULL,
	`proposal_hash` text NOT NULL,
	`replaces_id` text,
	`revision` integer NOT NULL,
	`head_sequence` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`confirmed_at` integer,
	`paused_at` integer,
	`raw_bytes` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_google_calendar_state" CHECK("kids_google_calendars"."status" IN ('pending','active','paused') AND "kids_google_calendars"."role" IN ('reported','school') AND "kids_google_calendars"."revision">=1 AND "kids_google_calendars"."head_sequence">=0 AND "kids_google_calendars"."raw_bytes">=512),
	CONSTRAINT "kids_google_calendar_json" CHECK(json_valid("kids_google_calendars"."child_ids_json") AND json_type("kids_google_calendars"."child_ids_json")='array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_google_calendar_owner` ON `kids_google_calendars` (`owner_user_id`,`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kids_google_calendar_active` ON `kids_google_calendars` (`owner_user_id`,`workspace_id`,`link_id`,`calendar_id`) WHERE "kids_google_calendars"."status"='active';--> statement-breakpoint
CREATE TABLE `kids_google_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`link_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_scope` text NOT NULL,
	`series_id` text NOT NULL,
	`original_start` text NOT NULL,
	`head_sequence` integer NOT NULL,
	`source_hash` text NOT NULL,
	`previous_hash` text,
	`source_json` text NOT NULL,
	`start_millis` integer NOT NULL,
	`end_millis` integer NOT NULL,
	`last_read_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`needs_review` integer DEFAULT 0 NOT NULL,
	`overrides_json` text DEFAULT '{}' NOT NULL,
	`raw_bytes` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`,`workspace_id`,`grant_id`) REFERENCES `kids_google_calendars`(`owner_user_id`,`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`workspace_id`,`last_read_id`) REFERENCES `kids_google_reads`(`owner_user_id`,`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kids_google_event_state" CHECK("kids_google_events"."event_scope" IN ('single','instance','master') AND "kids_google_events"."head_sequence">=1 AND "kids_google_events"."needs_review" IN (0,1) AND "kids_google_events"."raw_bytes">=512 AND "kids_google_events"."end_millis">"kids_google_events"."start_millis"),
	CONSTRAINT "kids_google_event_json" CHECK(json_valid("kids_google_events"."source_json") AND json_type("kids_google_events"."source_json")='object' AND json_valid("kids_google_events"."overrides_json") AND json_type("kids_google_events"."overrides_json")='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_google_event_identity` ON `kids_google_events` (`owner_user_id`,`workspace_id`,`link_id`,`calendar_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `kids_google_event_window` ON `kids_google_events` (`owner_user_id`,`workspace_id`,`start_millis`,`end_millis`);--> statement-breakpoint
CREATE TABLE `kids_google_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`epoch` integer NOT NULL,
	`grant_revision` integer NOT NULL,
	`service_grant_id` text NOT NULL,
	`service_revision` integer NOT NULL,
	`base_head` integer NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`known_heads_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`submitted_hash` text,
	`completed_revision` integer,
	`gaps_json` text DEFAULT '[]' NOT NULL,
	`complete` integer DEFAULT 0 NOT NULL,
	`observed_count` integer DEFAULT 0 NOT NULL,
	`raw_bytes` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`,`workspace_id`,`grant_id`) REFERENCES `kids_google_calendars`(`owner_user_id`,`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_google_read_state" CHECK("kids_google_reads"."status" IN ('pending','complete','incomplete','abandoned') AND "kids_google_reads"."complete" IN (0,1) AND "kids_google_reads"."epoch">=0 AND "kids_google_reads"."grant_revision">=1 AND "kids_google_reads"."service_revision">=1 AND "kids_google_reads"."base_head">=0 AND "kids_google_reads"."raw_bytes">=512 AND "kids_google_reads"."expires_at"="kids_google_reads"."created_at"+600000),
	CONSTRAINT "kids_google_read_json" CHECK(json_valid("kids_google_reads"."known_heads_json") AND json_type("kids_google_reads"."known_heads_json")='array' AND json_valid("kids_google_reads"."gaps_json") AND json_type("kids_google_reads"."gaps_json")='array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_google_read_owner` ON `kids_google_reads` (`owner_user_id`,`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kids_google_read_operation` ON `kids_google_reads` (`owner_user_id`,`workspace_id`,`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kids_google_read_pending` ON `kids_google_reads` (`owner_user_id`,`workspace_id`,`grant_id`) WHERE "kids_google_reads"."status"='pending';--> statement-breakpoint
CREATE TRIGGER kids_google_calendar_identity BEFORE UPDATE ON kids_google_calendars
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.link_id IS NOT OLD.link_id OR NEW.calendar_id IS NOT OLD.calendar_id OR NEW.account_label IS NOT OLD.account_label OR NEW.calendar_label IS NOT OLD.calendar_label OR NEW.child_ids_json IS NOT OLD.child_ids_json OR NEW.role IS NOT OLD.role OR NEW.proposal_hash IS NOT OLD.proposal_hash OR NEW.replaces_id IS NOT OLD.replaces_id OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.raw_bytes IS NOT OLD.raw_bytes OR NEW.revision<OLD.revision OR NEW.head_sequence<OLD.head_sequence OR (OLD.status='paused' AND NEW.status<>'paused')
BEGIN SELECT RAISE(ABORT,'immutable Google calendar selection'); END;
--> statement-breakpoint
CREATE TRIGGER kids_google_read_identity BEFORE UPDATE ON kids_google_reads
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.grant_id IS NOT OLD.grant_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.request_hash IS NOT OLD.request_hash OR NEW.epoch IS NOT OLD.epoch OR NEW.grant_revision IS NOT OLD.grant_revision OR NEW.service_grant_id IS NOT OLD.service_grant_id OR NEW.service_revision IS NOT OLD.service_revision OR NEW.base_head IS NOT OLD.base_head OR NEW.window_start IS NOT OLD.window_start OR NEW.window_end IS NOT OLD.window_end OR NEW.known_heads_json IS NOT OLD.known_heads_json OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.status<>'pending'
BEGIN SELECT RAISE(ABORT,'immutable Google read scope'); END;
--> statement-breakpoint
CREATE TRIGGER kids_google_event_identity BEFORE UPDATE ON kids_google_events
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.link_id IS NOT OLD.link_id OR NEW.calendar_id IS NOT OLD.calendar_id OR NEW.event_id IS NOT OLD.event_id OR NEW.event_scope IS NOT OLD.event_scope OR NEW.series_id IS NOT OLD.series_id OR NEW.original_start IS NOT OLD.original_start OR NEW.head_sequence<OLD.head_sequence
BEGIN SELECT RAISE(ABORT,'immutable Google event identity'); END;
--> statement-breakpoint
CREATE TRIGGER kids_google_event_source_insert BEFORE INSERT ON kids_google_events
WHEN NOT EXISTS(SELECT 1 FROM kids_google_calendars g JOIN kids_google_reads r ON r.grant_id=g.id AND r.owner_user_id=g.owner_user_id AND r.workspace_id=g.workspace_id WHERE g.owner_user_id=NEW.owner_user_id AND g.workspace_id=NEW.workspace_id AND g.id=NEW.grant_id AND g.link_id=NEW.link_id AND g.calendar_id=NEW.calendar_id AND r.id=NEW.last_read_id)
BEGIN SELECT RAISE(ABORT,'Google event source mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER kids_google_event_source_update BEFORE UPDATE OF grant_id,last_read_id ON kids_google_events
WHEN NOT EXISTS(SELECT 1 FROM kids_google_calendars g JOIN kids_google_reads r ON r.grant_id=g.id AND r.owner_user_id=g.owner_user_id AND r.workspace_id=g.workspace_id WHERE g.owner_user_id=NEW.owner_user_id AND g.workspace_id=NEW.workspace_id AND g.id=NEW.grant_id AND g.link_id=NEW.link_id AND g.calendar_id=NEW.calendar_id AND r.id=NEW.last_read_id)
BEGIN SELECT RAISE(ABORT,'Google event source mismatch'); END;

--> statement-breakpoint
CREATE TRIGGER kids_hosted_auth_google_operation BEFORE INSERT ON kids_hosted_auth
WHEN EXISTS(SELECT 1 FROM kids_operation_receipts WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND operation_id=NEW.operation_id AND json_extract(source_authority,'$.kind')='google-calendar-v1')
BEGIN SELECT RAISE(ABORT,'operation ID already committed by Google Calendar'); END;

--> statement-breakpoint
CREATE TRIGGER kids_hosted_batches_google_operation BEFORE INSERT ON kids_hosted_batches
WHEN EXISTS(SELECT 1 FROM kids_operation_receipts WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND operation_id=NEW.operation_id AND json_extract(source_authority,'$.kind')='google-calendar-v1')
BEGIN SELECT RAISE(ABORT,'operation ID already committed by Google Calendar'); END;

--> statement-breakpoint
CREATE TRIGGER kids_hosted_history_pages_google_operation BEFORE INSERT ON kids_hosted_history_pages
WHEN EXISTS(SELECT 1 FROM kids_operation_receipts WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND operation_id=NEW.operation_id AND json_extract(source_authority,'$.kind')='google-calendar-v1')
BEGIN SELECT RAISE(ABORT,'operation ID already committed by Google Calendar'); END;

--> statement-breakpoint
CREATE TRIGGER kids_hosted_removals_google_operation BEFORE INSERT ON kids_hosted_removals
WHEN EXISTS(SELECT 1 FROM kids_operation_receipts WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND operation_id=NEW.operation_id AND json_extract(source_authority,'$.kind')='google-calendar-v1')
BEGIN SELECT RAISE(ABORT,'operation ID already committed by Google Calendar'); END;
