CREATE TABLE `kids_chat_catalog` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`binding_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`last_activity` text NOT NULL,
	`metadata_hash` text NOT NULL,
	`seen_generation` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `kids_hosted_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_chat_catalog_kind" CHECK("kids_chat_catalog"."kind" IN ('group','1to1','channel') AND "kids_chat_catalog"."seen_generation">=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_chat_catalog_identity` ON `kids_chat_catalog` (`binding_id`,`chat_id`);--> statement-breakpoint
CREATE INDEX `kids_chat_catalog_page` ON `kids_chat_catalog` (`binding_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `kids_chat_scan_pages` (
	`binding_id` text NOT NULL,
	`generation` integer NOT NULL,
	`position_hash` text NOT NULL,
	`raw_count` integer NOT NULL,
	`operation_id` text NOT NULL,
	PRIMARY KEY(`binding_id`, `generation`, `position_hash`),
	FOREIGN KEY (`binding_id`) REFERENCES `kids_hosted_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_chat_page_bounds" CHECK("kids_chat_scan_pages"."generation">=1 AND "kids_chat_scan_pages"."raw_count">=0 AND "kids_chat_scan_pages"."raw_count"<=20)
);
--> statement-breakpoint
CREATE TABLE `kids_chat_scans` (
	`binding_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`generation` integer NOT NULL,
	`binding_revision` integer NOT NULL,
	`epoch` integer NOT NULL,
	`config_hash` text NOT NULL,
	`scope` text NOT NULL,
	`approval_surface` text NOT NULL,
	`offset` integer NOT NULL,
	`cursor` text,
	`total_count` integer,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	`last_write_nonce` text NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `kids_hosted_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_chat_scan_bounds" CHECK("kids_chat_scans"."revision">=1 AND "kids_chat_scans"."generation">=1 AND "kids_chat_scans"."offset">=0 AND ("kids_chat_scans"."total_count" IS NULL OR "kids_chat_scans"."total_count">=0)),
	CONSTRAINT "kids_chat_scan_scope" CHECK("kids_chat_scans"."scope" IN ('groups','all') AND "kids_chat_scans"."approval_surface" IN ('web','assistant')),
	CONSTRAINT "kids_chat_scan_status" CHECK("kids_chat_scans"."status" IN ('partial','complete','unconfirmed_end'))
);
