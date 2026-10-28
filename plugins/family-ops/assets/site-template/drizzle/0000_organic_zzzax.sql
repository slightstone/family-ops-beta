CREATE TABLE `workspace_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL,
	`policy` text NOT NULL,
	`operations` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_state_id_unique` ON `workspace_state` (`id`);