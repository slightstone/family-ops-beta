CREATE TABLE `workspace_billing_checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`mode` text NOT NULL,
	`body_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`price_id` text NOT NULL,
	`product_id` text NOT NULL,
	`offer_version` text NOT NULL,
	`origin` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`prior_subscription_id` text,
	`customer_id` text,
	`session_id` text,
	`expires_at` integer NOT NULL,
	`state` text DEFAULT 'creating' NOT NULL,
	`requested_generation` integer DEFAULT 0 NOT NULL,
	`verified_generation` integer DEFAULT -1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`verified_at` integer,
	`lease_token` text,
	`lease_until` integer,
	`retry_after` integer,
	`expire_operation_id` text,
	`expire_body_hash` text,
	`expire_created_at` integer,
	`expire_received_at` integer,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `workspace_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "checkout_state" CHECK("workspace_billing_checkouts"."state" IN ('creating','uncertain','open','bound','expired')),
	CONSTRAINT "checkout_mode" CHECK("workspace_billing_checkouts"."mode" IN ('test','live'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_provider_session` ON `workspace_billing_checkouts` (`mode`,`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_unresolved` ON `workspace_billing_checkouts` (`owner_user_id`,`workspace_id`) WHERE "workspace_billing_checkouts"."state" IN ('creating','uncertain','open');--> statement-breakpoint
CREATE INDEX `checkout_expiry` ON `workspace_billing_checkouts` (`verified_at`);--> statement-breakpoint
CREATE TABLE `workspace_billing_portals` (
	`owner_user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`mode` text NOT NULL,
	`billing_revision` integer NOT NULL,
	`body_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`customer_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`configuration_id` text NOT NULL,
	`origin` text NOT NULL,
	`provider_session_id` text,
	`completed_at` integer,
	PRIMARY KEY(`owner_user_id`, `operation_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `workspace_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `portal_expiry` ON `workspace_billing_portals` (`completed_at`);--> statement-breakpoint
CREATE INDEX `portal_rate` ON `workspace_billing_portals` (`owner_user_id`,`workspace_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `workspace_checkout_events` (
	`mode` text NOT NULL,
	`event_id` text NOT NULL,
	`intent_id` text NOT NULL,
	`event_type` text NOT NULL,
	`body_hash` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	PRIMARY KEY(`mode`, `event_id`),
	FOREIGN KEY (`intent_id`) REFERENCES `workspace_billing_checkouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checkout_event_expiry` ON `workspace_checkout_events` (`processed_at`);--> statement-breakpoint
ALTER TABLE `workspace_billing` ADD `checkout_intent_id` text;--> statement-breakpoint
CREATE TRIGGER checkout_start_validate BEFORE INSERT ON workspace_billing_checkouts BEGIN
 SELECT CASE WHEN NEW.grant_id<>NEW.workspace_id THEN RAISE(ABORT,'CHECKOUT_START_BLOCKED') END;
 SELECT CASE WHEN NEW.created_at<CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-600000 OR NEW.created_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+30000 THEN RAISE(ABORT,'CHECKOUT_REQUEST_EXPIRED') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM workspace_billing_checkouts WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND received_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-3600000)>=6 THEN RAISE(ABORT,'CHECKOUT_RATE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM workspace_billing_checkouts WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND state IN ('creating','uncertain','open')) THEN RAISE(ABORT,'CHECKOUT_START_BLOCKED') END;
 SELECT CASE WHEN NOT(
 (NEW.prior_subscription_id IS NULL AND NEW.customer_id IS NULL AND NOT EXISTS(SELECT 1 FROM workspace_billing WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id))
 OR EXISTS(SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=NEW.owner_user_id AND b.workspace_id=NEW.workspace_id AND b.mode=NEW.mode AND b.price_id=NEW.price_id AND b.customer_id=NEW.customer_id AND b.subscription_id=NEW.prior_subscription_id AND b.status IN ('canceled','incomplete_expired') AND b.verified_at IS NOT NULL AND b.verified_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND b.verified_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-300000 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL)
 ) THEN RAISE(ABORT,'CHECKOUT_START_BLOCKED') END;
END;
--> statement-breakpoint
CREATE TRIGGER checkout_expire_validate BEFORE UPDATE OF expire_operation_id ON workspace_billing_checkouts WHEN OLD.expire_operation_id IS NULL AND NEW.expire_operation_id IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.expire_created_at IS NULL OR NEW.expire_created_at<CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-600000 OR NEW.expire_created_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+30000 THEN RAISE(ABORT,'CHECKOUT_REQUEST_EXPIRED') END;
END;
--> statement-breakpoint
CREATE TRIGGER checkout_event_dirty AFTER INSERT ON workspace_checkout_events BEGIN
 UPDATE workspace_billing_checkouts SET requested_generation=requested_generation+1,revision=revision+1 WHERE id=NEW.intent_id AND mode=NEW.mode;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'CHECKOUT_BINDING_CHANGED') END;
 UPDATE workspace_billing SET requested_generation=requested_generation+1,revision=revision+1 WHERE checkout_intent_id=NEW.intent_id AND mode=NEW.mode;
END;
--> statement-breakpoint
CREATE TRIGGER portal_intent_validate BEFORE INSERT ON workspace_billing_portals BEGIN
 SELECT CASE WHEN NEW.grant_id<>NEW.workspace_id THEN RAISE(ABORT,'PORTAL_REQUEST_EXPIRED') END;
 SELECT CASE WHEN NEW.created_at<CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-600000 OR NEW.created_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+30000 THEN RAISE(ABORT,'PORTAL_REQUEST_EXPIRED') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM workspace_billing_portals WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND received_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-60000)>=6 THEN RAISE(ABORT,'PORTAL_RATE') END;
END;
--> statement-breakpoint
CREATE TRIGGER checkout_workspace_delete BEFORE DELETE ON workspace_state WHEN EXISTS(SELECT 1 FROM workspace_billing_checkouts WHERE owner_user_id=OLD.user_id AND workspace_id=OLD.id AND state IN ('creating','uncertain','open')) BEGIN SELECT RAISE(ABORT,'BILLING_CHECKOUT_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER checkout_deletion_receipt BEFORE INSERT ON workspace_deletion_receipts WHEN EXISTS(SELECT 1 FROM workspace_billing_checkouts WHERE owner_user_id=NEW.user_id AND workspace_id=NEW.workspace_id AND state IN ('creating','uncertain','open')) BEGIN SELECT RAISE(ABORT,'BILLING_CHECKOUT_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER checkout_terminal_state BEFORE UPDATE OF state ON workspace_billing_checkouts WHEN OLD.state IN ('bound','expired') AND NEW.state<>OLD.state BEGIN SELECT RAISE(ABORT,'CHECKOUT_TERMINAL_STATE'); END;
