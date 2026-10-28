-- Preserve all dependent triggers while rebuilding the CHECK-constrained table.
DROP TRIGGER kids_service_revision_guard;
--> statement-breakpoint
DROP TRIGGER commerce_kids_state_checkout;
--> statement-breakpoint
DROP TRIGGER commerce_kids_state_billing;
--> statement-breakpoint
DROP TRIGGER commerce_kids_deletions_checkout;
--> statement-breakpoint
DROP TRIGGER commerce_kids_deletions_billing;
--> statement-breakpoint
DROP TRIGGER kids_school_draft_insert;
--> statement-breakpoint
CREATE TABLE `__new_kids_service_access` (
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
	CONSTRAINT "kids_service_kind" CHECK(("__new_kids_service_access"."kind"='beta' AND "__new_kids_service_access"."beta_until" IS NOT NULL AND "__new_kids_service_access"."beta_until">"__new_kids_service_access"."created_at" AND "__new_kids_service_access"."billing_workspace_id" IS NULL) OR ("__new_kids_service_access"."kind"='subscription' AND "__new_kids_service_access"."beta_until" IS NULL AND "__new_kids_service_access"."billing_workspace_id" IS NOT NULL) OR ("__new_kids_service_access"."kind"='owned' AND "__new_kids_service_access"."beta_until" IS NULL AND "__new_kids_service_access"."billing_workspace_id" IS NULL)),
	CONSTRAINT "kids_service_revision" CHECK("__new_kids_service_access"."revision">=1),
	CONSTRAINT "kids_service_clock" CHECK("__new_kids_service_access"."created_at">=0 AND "__new_kids_service_access"."updated_at">="__new_kids_service_access"."created_at" AND ("__new_kids_service_access"."revoked_at" IS NULL OR "__new_kids_service_access"."revoked_at">="__new_kids_service_access"."created_at"))
);
--> statement-breakpoint
INSERT INTO `__new_kids_service_access`("owner_user_id", "workspace_id", "grant_id", "revision", "kind", "beta_until", "billing_workspace_id", "revoked_at", "created_at", "updated_at") SELECT "owner_user_id", "workspace_id", "grant_id", "revision", "kind", "beta_until", "billing_workspace_id", "revoked_at", "created_at", "updated_at" FROM `kids_service_access`;--> statement-breakpoint
DROP TABLE `kids_service_access`;--> statement-breakpoint
ALTER TABLE `__new_kids_service_access` RENAME TO `kids_service_access`;--> statement-breakpoint

CREATE UNIQUE INDEX `kids_service_access_grant_id_unique` ON `kids_service_access` (`grant_id`);
--> statement-breakpoint
CREATE TRIGGER kids_service_revision_guard BEFORE UPDATE ON kids_service_access
WHEN NEW.owner_user_id<>OLD.owner_user_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.grant_id<>OLD.grant_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'KIDS_SERVICE_GRANT_CHANGED'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_kids_state_checkout BEFORE DELETE ON kids_state WHEN EXISTS(SELECT 1 FROM workspace_billing_checkouts x WHERE x.owner_user_id=OLD.user_id AND x.workspace_id IN (SELECT account_id FROM kids_commerce WHERE owner_user_id=OLD.user_id AND workspace_id=OLD.id UNION SELECT billing_workspace_id FROM kids_service_access WHERE owner_user_id=OLD.user_id AND workspace_id=OLD.id AND kind='subscription') AND x.state IN ('creating','uncertain','open')) BEGIN SELECT RAISE(ABORT,'BILLING_CHECKOUT_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_kids_state_billing BEFORE DELETE ON kids_state WHEN EXISTS(SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=OLD.user_id AND b.workspace_id IN (SELECT account_id FROM kids_commerce WHERE owner_user_id=OLD.user_id AND workspace_id=OLD.id UNION SELECT billing_workspace_id FROM kids_service_access WHERE owner_user_id=OLD.user_id AND workspace_id=OLD.id AND kind='subscription') AND NOT (b.status IN ('canceled','incomplete_expired') AND b.verified_at IS NOT NULL AND b.verified_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND b.verified_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-300000 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL)) BEGIN SELECT RAISE(ABORT,'BILLING_CANCEL_FIRST'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_kids_deletions_checkout BEFORE INSERT ON kids_deletions WHEN EXISTS(SELECT 1 FROM workspace_billing_checkouts x WHERE x.owner_user_id=NEW.user_id AND x.workspace_id IN (SELECT account_id FROM kids_commerce WHERE owner_user_id=NEW.user_id AND workspace_id=NEW.workspace_id UNION SELECT billing_workspace_id FROM kids_service_access WHERE owner_user_id=NEW.user_id AND workspace_id=NEW.workspace_id AND kind='subscription') AND x.state IN ('creating','uncertain','open')) BEGIN SELECT RAISE(ABORT,'BILLING_CHECKOUT_PENDING'); END;
--> statement-breakpoint
CREATE TRIGGER commerce_kids_deletions_billing BEFORE INSERT ON kids_deletions WHEN EXISTS(SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=NEW.user_id AND b.workspace_id IN (SELECT account_id FROM kids_commerce WHERE owner_user_id=NEW.user_id AND workspace_id=NEW.workspace_id UNION SELECT billing_workspace_id FROM kids_service_access WHERE owner_user_id=NEW.user_id AND workspace_id=NEW.workspace_id AND kind='subscription') AND NOT (b.status IN ('canceled','incomplete_expired') AND b.verified_at IS NOT NULL AND b.verified_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND b.verified_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-300000 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL)) BEGIN SELECT RAISE(ABORT,'BILLING_CANCEL_FIRST'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_draft_insert BEFORE INSERT ON kids_school_drafts
WHEN NEW.status<>'pending' OR NEW.applied_operation IS NOT NULL OR length(NEW.request_hash)<>64 OR length(NEW.proposal_hash)<>64 OR length(NEW.source_hash)<>64 OR length(NEW.source_text)>16000 OR length(NEW.source_text)=0 OR NOT json_valid(NEW.proposal_json)
 OR NOT EXISTS(SELECT 1 FROM kids_state k JOIN kids_operation_receipts r ON r.owner_user_id=k.user_id AND r.workspace_id=k.id JOIN kids_service_access a ON a.owner_user_id=k.user_id AND a.workspace_id=k.id WHERE k.user_id=NEW.owner_user_id AND k.id=NEW.workspace_id AND k.revision=NEW.created_revision AND r.operation_id=NEW.operation_id AND r.body_hash=NEW.request_hash AND r.committed_revision=NEW.created_revision AND r.created_at=NEW.created_at AND json_extract(r.source_authority,'$.kind')='parent-calendar-draft-v1' AND json_extract(r.source_authority,'$.consentVersion')='calendar-draft-v1-2026-10-24' AND json_extract(r.source_authority,'$.parentConfirmed')=1 AND json_extract(r.source_authority,'$.draftId')=NEW.id AND json_extract(r.source_authority,'$.serviceGrantId')=NEW.service_grant_id AND json_extract(r.source_authority,'$.serviceRevision')=NEW.service_revision AND a.grant_id=NEW.service_grant_id AND a.revision=NEW.service_revision AND a.revoked_at IS NULL AND a.created_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND ((a.kind='owned' AND a.beta_until IS NULL AND a.billing_workspace_id IS NULL) OR (a.kind='beta' AND a.beta_until>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) OR (a.kind='subscription' AND EXISTS(SELECT 1 FROM workspace_billing b WHERE b.owner_user_id=a.owner_user_id AND b.workspace_id=a.billing_workspace_id AND b.status='active' AND b.paid_through>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND b.verified_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND b.verified_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-300000 AND b.requested_generation=b.verified_generation AND b.lease_token IS NULL))) AND NOT EXISTS(SELECT 1 FROM json_each(NEW.proposal_json,'$.childIds') c WHERE NOT EXISTS(SELECT 1 FROM json_each(k.document,'$.children') p WHERE json_extract(p.value,'$.id')=c.value)) AND (SELECT COUNT(*) FROM kids_school_drafts WHERE owner_user_id=k.user_id AND workspace_id=k.id AND status='pending' AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))<5 AND ((SELECT COUNT(*) FROM kids_school_drafts WHERE owner_user_id=k.user_id AND workspace_id=k.id)+(SELECT COUNT(*) FROM kids_school_calendars WHERE owner_user_id=k.user_id AND workspace_id=k.id))<100 AND COALESCE((SELECT SUM(raw_bytes+2048) FROM kids_school_drafts WHERE owner_user_id=k.user_id AND workspace_id=k.id),0)+(SELECT COUNT(*)*512 FROM kids_school_calendars WHERE owner_user_id=k.user_id AND workspace_id=k.id)+NEW.raw_bytes+2048<=4194304)
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_DRAFT_AUTHORITY'); END;
