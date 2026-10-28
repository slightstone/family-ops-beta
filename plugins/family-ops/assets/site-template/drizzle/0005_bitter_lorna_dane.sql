CREATE TABLE `kids_deletions` (
	`user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`base_revision` integer NOT NULL,
	`deleted_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `operation_id`)
);
--> statement-breakpoint
CREATE INDEX `kids_deletion_expiry` ON `kids_deletions` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `kids_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL,
	`operations` text NOT NULL,
	`token_hash` text,
	`epoch` integer NOT NULL,
	`write_times` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_state_id_unique` ON `kids_state` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kids_connector_hash` ON `kids_state` (`token_hash`);