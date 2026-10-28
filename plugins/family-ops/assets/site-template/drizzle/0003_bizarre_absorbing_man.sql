CREATE TABLE `workspace_billing` (
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`mode` text NOT NULL,
	`customer_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`price_id` text NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`paid_through` integer,
	`cancel_at_period_end` integer DEFAULT 0 NOT NULL,
	`verified_at` integer,
	`requested_generation` integer DEFAULT 0 NOT NULL,
	`verified_generation` integer DEFAULT -1 NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`retry_after` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_user_id`, `workspace_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `workspace_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_mode" CHECK("workspace_billing"."mode" IN ('test','live'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription` ON `workspace_billing` (`mode`,`subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customer` ON `workspace_billing` (`mode`,`customer_id`);--> statement-breakpoint
CREATE TABLE `workspace_billing_events` (
	`mode` text NOT NULL,
	`event_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`event_type` text NOT NULL,
	`body_hash` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	PRIMARY KEY(`mode`, `event_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `workspace_billing`(`owner_user_id`,`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_event_expiry` ON `workspace_billing_events` (`processed_at`);--> statement-breakpoint
CREATE TABLE `workspace_billing_refreshes` (
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`mode` text NOT NULL,
	`body_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`completed_at` integer,
	`requested_generation` integer,
	PRIMARY KEY(`actor_id`, `operation_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `workspace_billing`(`owner_user_id`,`workspace_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_refresh_expiry` ON `workspace_billing_refreshes` (`completed_at`);--> statement-breakpoint
CREATE INDEX `billing_refresh_rate` ON `workspace_billing_refreshes` (`owner_user_id`,`workspace_id`,`received_at`);--> statement-breakpoint
CREATE TRIGGER billing_event_dirty AFTER INSERT ON workspace_billing_events BEGIN
 UPDATE workspace_billing SET requested_generation=requested_generation+1,revision=revision+1
 WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND mode=NEW.mode AND subscription_id=NEW.subscription_id;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'BILLING_BINDING_CHANGED') END;
END;
--> statement-breakpoint
CREATE TRIGGER billing_refresh_validate BEFORE INSERT ON workspace_billing_refreshes BEGIN
 SELECT CASE WHEN NEW.actor_id<>NEW.owner_user_id OR NEW.grant_id<>NEW.workspace_id OR NOT EXISTS(SELECT 1 FROM workspace_billing WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND mode=NEW.mode) THEN RAISE(ABORT,'BILLING_OWNER_CHANGED') END;
 SELECT CASE WHEN NEW.created_at<CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-600000 OR NEW.created_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+30000 THEN RAISE(ABORT,'BILLING_REQUEST_EXPIRED') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM workspace_billing_refreshes WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND received_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-60000)>=6 THEN RAISE(ABORT,'BILLING_REFRESH_LIMIT') END;
END;
--> statement-breakpoint
CREATE TRIGGER billing_refresh_dirty AFTER INSERT ON workspace_billing_refreshes BEGIN
 UPDATE workspace_billing SET requested_generation=requested_generation+1,revision=revision+1 WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND mode=NEW.mode;
 UPDATE workspace_billing_refreshes SET requested_generation=(SELECT requested_generation FROM workspace_billing WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id) WHERE actor_id=NEW.actor_id AND operation_id=NEW.operation_id;
END;
--> statement-breakpoint
CREATE TRIGGER billing_workspace_delete BEFORE DELETE ON workspace_state WHEN EXISTS(
 SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=OLD.user_id AND b.workspace_id=OLD.id AND NOT (
 b.status IN ('canceled','incomplete_expired') AND b.verified_at IS NOT NULL
 AND b.verified_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
 AND b.verified_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-300000
 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL
 )) BEGIN SELECT RAISE(ABORT,'BILLING_CANCEL_FIRST'); END;
--> statement-breakpoint
CREATE TRIGGER billing_deletion_receipt BEFORE INSERT ON workspace_deletion_receipts WHEN EXISTS(
 SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=NEW.user_id AND b.workspace_id=NEW.workspace_id AND NOT (
 b.status IN ('canceled','incomplete_expired') AND b.verified_at IS NOT NULL
 AND b.verified_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
 AND b.verified_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-300000
 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL
 )) BEGIN SELECT RAISE(ABORT,'BILLING_CANCEL_FIRST'); END;
