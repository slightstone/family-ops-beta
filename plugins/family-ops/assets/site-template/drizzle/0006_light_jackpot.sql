CREATE TABLE `kids_service_access` (
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`beta_until` integer,
	`billing_workspace_id` text,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_user_id`, `workspace_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`billing_workspace_id`) REFERENCES `workspace_billing`(`owner_user_id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_service_kind" CHECK(("kids_service_access"."kind"='beta' AND "kids_service_access"."beta_until" IS NOT NULL AND "kids_service_access"."beta_until">"kids_service_access"."created_at" AND "kids_service_access"."billing_workspace_id" IS NULL) OR ("kids_service_access"."kind"='subscription' AND "kids_service_access"."beta_until" IS NULL AND "kids_service_access"."billing_workspace_id" IS NOT NULL)),
	CONSTRAINT "kids_service_revision" CHECK("kids_service_access"."revision">=1),
	CONSTRAINT "kids_service_clock" CHECK("kids_service_access"."created_at">=0 AND "kids_service_access"."updated_at">="kids_service_access"."created_at" AND ("kids_service_access"."revoked_at" IS NULL OR "kids_service_access"."revoked_at">="kids_service_access"."created_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_service_access_grant_id_unique` ON `kids_service_access` (`grant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kids_owner_workspace` ON `kids_state` (`user_id`,`id`);--> statement-breakpoint
-- Grant identity/owner never retarget; a replacement is a new row in an atomic batch.
CREATE TRIGGER kids_service_revision_guard BEFORE UPDATE ON kids_service_access
WHEN NEW.owner_user_id<>OLD.owner_user_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.grant_id<>OLD.grant_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'KIDS_SERVICE_GRANT_CHANGED'); END;
