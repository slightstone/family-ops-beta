CREATE TABLE `kids_hosted_history_batch_members` (
	`batch_id` text NOT NULL,
	`message_sequence` integer NOT NULL,
	`body_hash` text NOT NULL,
	`fingerprint` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	PRIMARY KEY(`batch_id`, `message_sequence`),
	FOREIGN KEY (`batch_id`) REFERENCES `kids_hosted_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_sequence`) REFERENCES `kids_hosted_history_messages`(`sequence`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_history_batch_message` ON `kids_hosted_history_batch_members` (`batch_id`,`chat_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `kids_hosted_history_heads` (
	`binding_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`message_sequence` integer NOT NULL,
	`body_hash` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`binding_id`, `chat_id`, `message_id`),
	FOREIGN KEY (`binding_id`) REFERENCES `kids_hosted_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_sequence`) REFERENCES `kids_hosted_history_messages`(`sequence`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kids_hosted_history_messages` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`binding_revision` integer NOT NULL,
	`epoch` integer NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`body_hash` text NOT NULL,
	`fingerprint` text NOT NULL,
	`message_millis` integer NOT NULL,
	`raw_body` text,
	`raw_bytes` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`page_id`) REFERENCES `kids_hosted_history_pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`binding_id`) REFERENCES `kids_hosted_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_history_message_size" CHECK("kids_hosted_history_messages"."raw_bytes">=0 AND "kids_hosted_history_messages"."raw_bytes"<=262144)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_history_message_identity` ON `kids_hosted_history_messages` (`binding_id`,`chat_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `kids_history_message_queue` ON `kids_hosted_history_messages` (`binding_id`,`chat_id`,`consumed_at`);--> statement-breakpoint
CREATE TABLE `kids_hosted_history_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`scan_id` text NOT NULL,
	`scan_revision` integer NOT NULL,
	`request_json` text NOT NULL,
	`webhook_watermark` integer NOT NULL,
	`history_watermark` integer NOT NULL,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`response_hash` text,
	`result_json` text,
	`gap` text,
	`fetched_at` integer,
	FOREIGN KEY (`scan_id`) REFERENCES `kids_hosted_history_scans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_history_page_status" CHECK("kids_hosted_history_pages"."status" IN ('fetching','failed','committed','noop'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_history_read_operation` ON `kids_hosted_history_pages` (`owner_user_id`,`workspace_id`,`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kids_history_page_inflight` ON `kids_hosted_history_pages` (`scan_id`) WHERE "kids_hosted_history_pages"."status" IN ('fetching','failed');--> statement-breakpoint
CREATE TABLE `kids_hosted_history_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`authority_hash` text NOT NULL,
	`authority_json` text NOT NULL,
	`since` integer NOT NULL,
	`until` integer NOT NULL,
	`revision` integer NOT NULL,
	`page_count` integer NOT NULL,
	`seen_count` integer NOT NULL,
	`cursor` text,
	`offset` integer NOT NULL,
	`total_count` integer,
	`status` text NOT NULL,
	`gap` text,
	`oldest` integer,
	`newest` integer,
	FOREIGN KEY (`binding_id`) REFERENCES `kids_hosted_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_history_scan_window" CHECK("kids_hosted_history_scans"."until"-"kids_hosted_history_scans"."since"=604800000 AND "kids_hosted_history_scans"."page_count" BETWEEN 0 AND 5 AND "kids_hosted_history_scans"."offset">=0 AND "kids_hosted_history_scans"."seen_count">=0 AND "kids_hosted_history_scans"."revision">=1),
	CONSTRAINT "kids_history_scan_status" CHECK("kids_hosted_history_scans"."status" IN ('pending','exhausted','capped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_history_scan_authority` ON `kids_hosted_history_scans` (`owner_user_id`,`workspace_id`,`chat_id`,`authority_hash`);