CREATE TABLE `kids_commerce` (
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`prepare_operation_id` text NOT NULL,
	`prepare_body_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_user_id`, `workspace_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`account_id`) REFERENCES `workspace_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_commerce_account` ON `kids_commerce` (`owner_user_id`,`account_id`);--> statement-breakpoint
ALTER TABLE `workspace_billing_checkouts` ADD `surface` text DEFAULT 'planner' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_billing_checkouts` ADD `kids_workspace_id` text;--> statement-breakpoint
ALTER TABLE `workspace_billing_portals` ADD `surface` text DEFAULT 'planner' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_billing_portals` ADD `kids_workspace_id` text;--> statement-breakpoint
ALTER TABLE `workspace_state` ADD `purpose` text DEFAULT 'planner' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER commerce_purpose_insert BEFORE INSERT ON workspace_state BEGIN
 SELECT CASE WHEN NEW.purpose NOT IN ('planner','account') THEN RAISE(ABORT,'ACCOUNT_PURPOSE_INVALID') END;
 SELECT CASE WHEN NEW.purpose='account' AND (NOT json_valid(NEW.document) OR json_extract(NEW.document,'$.accountOnly') IS NOT 1 OR json_extract(NEW.document,'$.id') IS NOT NEW.id OR NEW.policy<>'{}' OR NEW.operations<>'{}') THEN RAISE(ABORT,'ACCOUNT_PURPOSE_INVALID') END;
END;
--> statement-breakpoint
CREATE TRIGGER commerce_purpose_update BEFORE UPDATE ON workspace_state BEGIN
 SELECT CASE WHEN NEW.purpose NOT IN ('planner','account') OR (OLD.purpose='planner' AND NEW.purpose<>'planner') OR (OLD.purpose='account' AND (NEW.user_id<>OLD.user_id OR NEW.id<>OLD.id)) THEN RAISE(ABORT,'ACCOUNT_PURPOSE_INVALID') END;
 SELECT CASE WHEN NEW.purpose='account' AND (NEW.document<>OLD.document OR NEW.policy<>OLD.policy OR NEW.operations<>OLD.operations) THEN RAISE(ABORT,'ACCOUNT_PURPOSE_INVALID') END;
END;
--> statement-breakpoint
CREATE TRIGGER kids_commerce_immutable BEFORE UPDATE ON kids_commerce BEGIN SELECT RAISE(ABORT,'KIDS_COMMERCE_IDENTITY_CHANGED'); END;
--> statement-breakpoint
CREATE TRIGGER account_only_workspace_invitations_insert BEFORE INSERT ON workspace_invitations WHEN NOT EXISTS(SELECT 1 FROM workspace_state w WHERE w.user_id=NEW.owner_user_id AND w.id=NEW.workspace_id AND w.purpose='planner') BEGIN SELECT RAISE(ABORT,'ACCOUNT_ONLY_NO_SHARING'); END;
--> statement-breakpoint
CREATE TRIGGER account_only_workspace_memberships_insert BEFORE INSERT ON workspace_memberships WHEN NOT EXISTS(SELECT 1 FROM workspace_state w WHERE w.user_id=NEW.owner_user_id AND w.id=NEW.workspace_id AND w.purpose='planner') BEGIN SELECT RAISE(ABORT,'ACCOUNT_ONLY_NO_SHARING'); END;
--> statement-breakpoint
CREATE TRIGGER kids_workspace_billing_checkouts_target BEFORE INSERT ON workspace_billing_checkouts BEGIN
 SELECT CASE WHEN NOT ((NEW.surface='planner' AND NEW.kids_workspace_id IS NULL AND EXISTS(SELECT 1 FROM workspace_state w WHERE w.user_id=NEW.owner_user_id AND w.id=NEW.workspace_id AND w.purpose='planner')) OR (NEW.surface='kids' AND NEW.kids_workspace_id IS NOT NULL AND EXISTS(SELECT 1 FROM kids_commerce c JOIN kids_state k ON k.user_id=c.owner_user_id AND k.id=c.workspace_id WHERE c.owner_user_id=NEW.owner_user_id AND c.account_id=NEW.workspace_id AND c.workspace_id=NEW.kids_workspace_id))) THEN RAISE(ABORT,'CHECKOUT_START_BLOCKED') END;
END;
--> statement-breakpoint
CREATE TRIGGER kids_workspace_billing_checkouts_target_immutable BEFORE UPDATE ON workspace_billing_checkouts WHEN NEW.surface<>OLD.surface OR NEW.kids_workspace_id IS NOT OLD.kids_workspace_id BEGIN SELECT RAISE(ABORT,'KIDS_COMMERCE_IDENTITY_CHANGED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_workspace_billing_portals_target BEFORE INSERT ON workspace_billing_portals BEGIN
 SELECT CASE WHEN NOT ((NEW.surface='planner' AND NEW.kids_workspace_id IS NULL AND EXISTS(SELECT 1 FROM workspace_state w WHERE w.user_id=NEW.owner_user_id AND w.id=NEW.workspace_id AND w.purpose='planner')) OR (NEW.surface='kids' AND NEW.kids_workspace_id IS NOT NULL AND EXISTS(SELECT 1 FROM kids_commerce c JOIN kids_state k ON k.user_id=c.owner_user_id AND k.id=c.workspace_id WHERE c.owner_user_id=NEW.owner_user_id AND c.account_id=NEW.workspace_id AND c.workspace_id=NEW.kids_workspace_id))) THEN RAISE(ABORT,'CHECKOUT_START_BLOCKED') END;
END;
--> statement-breakpoint
CREATE TRIGGER kids_workspace_billing_portals_target_immutable BEFORE UPDATE ON workspace_billing_portals WHEN NEW.surface<>OLD.surface OR NEW.kids_workspace_id IS NOT OLD.kids_workspace_id BEGIN SELECT RAISE(ABORT,'KIDS_COMMERCE_IDENTITY_CHANGED'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_kids_state_checkout BEFORE DELETE ON kids_state WHEN EXISTS(SELECT 1 FROM workspace_billing_checkouts x WHERE x.owner_user_id=OLD.user_id AND x.workspace_id IN (SELECT account_id FROM kids_commerce WHERE owner_user_id=OLD.user_id AND workspace_id=OLD.id UNION SELECT billing_workspace_id FROM kids_service_access WHERE owner_user_id=OLD.user_id AND workspace_id=OLD.id AND kind='subscription') AND x.state IN ('creating','uncertain','open')) BEGIN SELECT RAISE(ABORT,'BILLING_CHECKOUT_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_kids_state_billing BEFORE DELETE ON kids_state WHEN EXISTS(SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=OLD.user_id AND b.workspace_id IN (SELECT account_id FROM kids_commerce WHERE owner_user_id=OLD.user_id AND workspace_id=OLD.id UNION SELECT billing_workspace_id FROM kids_service_access WHERE owner_user_id=OLD.user_id AND workspace_id=OLD.id AND kind='subscription') AND NOT (b.status IN ('canceled','incomplete_expired') AND b.verified_at IS NOT NULL AND b.verified_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND b.verified_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-300000 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL)) BEGIN SELECT RAISE(ABORT,'BILLING_CANCEL_FIRST'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_kids_deletions_checkout BEFORE INSERT ON kids_deletions WHEN EXISTS(SELECT 1 FROM workspace_billing_checkouts x WHERE x.owner_user_id=NEW.user_id AND x.workspace_id IN (SELECT account_id FROM kids_commerce WHERE owner_user_id=NEW.user_id AND workspace_id=NEW.workspace_id UNION SELECT billing_workspace_id FROM kids_service_access WHERE owner_user_id=NEW.user_id AND workspace_id=NEW.workspace_id AND kind='subscription') AND x.state IN ('creating','uncertain','open')) BEGIN SELECT RAISE(ABORT,'BILLING_CHECKOUT_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_kids_deletions_billing BEFORE INSERT ON kids_deletions WHEN EXISTS(SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=NEW.user_id AND b.workspace_id IN (SELECT account_id FROM kids_commerce WHERE owner_user_id=NEW.user_id AND workspace_id=NEW.workspace_id UNION SELECT billing_workspace_id FROM kids_service_access WHERE owner_user_id=NEW.user_id AND workspace_id=NEW.workspace_id AND kind='subscription') AND NOT (b.status IN ('canceled','incomplete_expired') AND b.verified_at IS NOT NULL AND b.verified_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND b.verified_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-300000 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL)) BEGIN SELECT RAISE(ABORT,'BILLING_CANCEL_FIRST'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_mapping_delete BEFORE DELETE ON kids_commerce WHEN EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id) AND (EXISTS(SELECT 1 FROM workspace_billing_checkouts x WHERE x.owner_user_id=OLD.owner_user_id AND x.workspace_id=OLD.account_id AND x.state IN ('creating','uncertain','open')) OR EXISTS(SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=OLD.owner_user_id AND b.workspace_id=OLD.account_id AND NOT (b.status IN ('canceled','incomplete_expired') AND b.verified_at IS NOT NULL AND b.verified_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND b.verified_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-300000 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL))) BEGIN SELECT RAISE(ABORT,'BILLING_CANCEL_FIRST'); END;

--> statement-breakpoint
CREATE TRIGGER commerce_account_paired_delete BEFORE DELETE ON workspace_state WHEN OLD.purpose='account' AND EXISTS(SELECT 1 FROM kids_commerce c JOIN kids_state k ON k.user_id=c.owner_user_id AND k.id=c.workspace_id WHERE c.owner_user_id=OLD.user_id AND c.account_id=OLD.id) BEGIN SELECT RAISE(ABORT,'KIDS_ACCOUNT_REMOVE_TOGETHER'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_mapping_paired_delete BEFORE DELETE ON kids_commerce WHEN EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id) BEGIN SELECT RAISE(ABORT,'KIDS_ACCOUNT_REMOVE_TOGETHER'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_kids_delete_receipt BEFORE DELETE ON kids_state WHEN EXISTS(SELECT 1 FROM kids_commerce c JOIN workspace_state w ON w.user_id=c.owner_user_id AND w.id=c.account_id WHERE c.owner_user_id=OLD.user_id AND c.workspace_id=OLD.id AND w.purpose='account') AND NOT EXISTS(SELECT 1 FROM kids_deletions d WHERE d.user_id=OLD.user_id AND d.workspace_id=OLD.id AND d.base_revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'KIDS_ACCOUNT_REMOVE_TOGETHER'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_account_cleanup AFTER DELETE ON kids_commerce WHEN NOT EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id) BEGIN DELETE FROM workspace_state WHERE user_id=OLD.owner_user_id AND id=OLD.account_id AND purpose='account'; END;
