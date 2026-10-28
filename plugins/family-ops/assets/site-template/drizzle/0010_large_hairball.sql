CREATE TABLE `kids_hosted_auth` (
	`owner_user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`body_hash` text NOT NULL,
	`config_hash` text NOT NULL,
	`application_id` text NOT NULL,
	`production` integer NOT NULL,
	`endpoint_id` text NOT NULL,
	`scope_reference` text NOT NULL,
	`scope_id` text,
	`workspace_revision` integer NOT NULL,
	`epoch` integer NOT NULL,
	`service_grant_id` text NOT NULL,
	`service_revision` integer NOT NULL,
	`binding_id` text,
	`binding_revision` integer,
	`expected_account_id` text,
	`expected_identity_hash` text,
	`state_hash` text,
	`redirect_uri` text NOT NULL,
	`consent_version` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`auth_link` text,
	`candidate_account_id` text,
	`sync_status` text,
	`completed_at` integer,
	`verified_binding_id` text,
	`verified_identity_hash` text,
	PRIMARY KEY(`owner_user_id`, `operation_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_hosted_auth_status" CHECK("kids_hosted_auth"."status" IN ('scope_creating','scope_unknown','scope_ready','link_creating','link_unknown','ready','verifying','connected','failed','expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_auth_state_hash_unique` ON `kids_hosted_auth` (`state_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `kids_hosted_auth_pending` ON `kids_hosted_auth` (`owner_user_id`,`workspace_id`) WHERE "kids_hosted_auth"."status" NOT IN ('connected','expired','failed');--> statement-breakpoint
CREATE INDEX `kids_hosted_auth_workspace` ON `kids_hosted_auth` (`owner_user_id`,`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `kids_hosted_bindings` ADD `provider_identity_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
DROP TRIGGER kids_hosted_binding_identity;--> statement-breakpoint
CREATE TRIGGER kids_hosted_binding_identity BEFORE UPDATE ON kids_hosted_bindings
WHEN NEW.id<>OLD.id OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.workspace_id<>OLD.workspace_id
 OR NEW.application_id<>OLD.application_id OR NEW.production<>OLD.production OR NEW.endpoint_id<>OLD.endpoint_id
 OR NEW.scope_id<>OLD.scope_id OR NEW.account_id<>OLD.account_id OR NEW.created_at<>OLD.created_at
 OR NEW.consent_version<>OLD.consent_version OR NEW.provider_identity_hash<>OLD.provider_identity_hash OR NEW.revision<OLD.revision
 OR (NEW.active<>OLD.active AND NEW.revision<=OLD.revision)
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_BINDING_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER kids_hosted_auth_identity BEFORE UPDATE ON kids_hosted_auth
WHEN OLD.status='connected' OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.operation_id<>OLD.operation_id
 OR NEW.workspace_id<>OLD.workspace_id OR NEW.body_hash<>OLD.body_hash OR NEW.config_hash<>OLD.config_hash
 OR NEW.application_id<>OLD.application_id OR NEW.production<>OLD.production OR NEW.endpoint_id<>OLD.endpoint_id
 OR NEW.scope_reference<>OLD.scope_reference OR NEW.workspace_revision<>OLD.workspace_revision OR NEW.epoch<>OLD.epoch
 OR NEW.service_grant_id<>OLD.service_grant_id OR NEW.service_revision<>OLD.service_revision
 OR NEW.binding_id IS NOT OLD.binding_id OR NEW.binding_revision IS NOT OLD.binding_revision
 OR NEW.expected_account_id IS NOT OLD.expected_account_id OR NEW.expected_identity_hash IS NOT OLD.expected_identity_hash
 OR NEW.redirect_uri<>OLD.redirect_uri OR NEW.consent_version<>OLD.consent_version
 OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at
 OR (OLD.scope_id IS NOT NULL AND NEW.scope_id IS NOT OLD.scope_id)
 OR (OLD.state_hash IS NOT NULL AND NEW.state_hash IS NOT OLD.state_hash)
 OR (OLD.candidate_account_id IS NOT NULL AND NEW.candidate_account_id IS NOT OLD.candidate_account_id)
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_AUTH_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER kids_hosted_auth_complete AFTER UPDATE OF status ON kids_hosted_auth
WHEN NEW.status='connected'
BEGIN
 SELECT CASE WHEN OLD.status<>'verifying' OR NEW.verified_binding_id IS NULL OR NEW.verified_identity_hash IS NULL
  OR length(NEW.verified_identity_hash)<>64 OR NEW.verified_identity_hash GLOB '*[^a-f0-9]*'
  OR NEW.candidate_account_id IS NULL OR NEW.scope_id IS NULL OR NEW.completed_at IS NULL
  OR (NEW.expected_account_id IS NOT NULL AND NEW.candidate_account_id<>NEW.expected_account_id)
  OR (NEW.expected_identity_hash IS NOT NULL AND NEW.verified_identity_hash<>NEW.expected_identity_hash)
  THEN RAISE(ABORT,'KIDS_HOSTED_BINDING_UNCONFIRMED') END;
 INSERT INTO kids_hosted_bindings(id,owner_user_id,workspace_id,application_id,production,endpoint_id,scope_id,account_id,revision,active,consent_version,created_at,reconciliation_reason,provider_identity_hash)
 SELECT NEW.verified_binding_id,NEW.owner_user_id,NEW.workspace_id,NEW.application_id,NEW.production,NEW.endpoint_id,NEW.scope_id,NEW.candidate_account_id,1,1,NEW.consent_version,NEW.completed_at,'history_reconciliation_required',NEW.verified_identity_hash
 WHERE NEW.binding_id IS NULL;
 UPDATE kids_hosted_bindings SET active=1,revision=revision+1,reconciliation_reason=COALESCE(reconciliation_reason,'history_reconciliation_required')
 WHERE NEW.binding_id IS NOT NULL AND id=NEW.binding_id AND id=NEW.verified_binding_id
  AND owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND application_id=NEW.application_id
  AND production=NEW.production AND endpoint_id=NEW.endpoint_id AND scope_id=NEW.scope_id
  AND account_id=NEW.candidate_account_id AND provider_identity_hash=NEW.verified_identity_hash AND revision=NEW.binding_revision;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM kids_hosted_bindings WHERE id=NEW.verified_binding_id
  AND owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND application_id=NEW.application_id
  AND production=NEW.production AND endpoint_id=NEW.endpoint_id AND scope_id=NEW.scope_id
  AND account_id=NEW.candidate_account_id AND provider_identity_hash=NEW.verified_identity_hash AND active=1
  AND revision=CASE WHEN NEW.binding_id IS NULL THEN 1 ELSE NEW.binding_revision+1 END)
  THEN RAISE(ABORT,'KIDS_HOSTED_BINDING_UNCONFIRMED') END;
END;
