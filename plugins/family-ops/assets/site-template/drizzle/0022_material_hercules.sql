CREATE TABLE IF NOT EXISTS `kids_google_effects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`grant_revision` integer NOT NULL,
	`link_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`service_grant_id` text NOT NULL,
	`service_revision` integer NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_snapshot_json` text NOT NULL,
	`source_hash` text NOT NULL,
	`mode` text NOT NULL,
	`previous_effect_id` text,
	`reference` text NOT NULL,
	`payload_json` text NOT NULL,
	`before_json` text,
	`proposal_hash` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`created_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`approved_at` integer,
	`claim_id` text,
	`claimed_at` integer,
	`provider_event_id` text,
	`read_json` text DEFAULT 'null' NOT NULL,
	`checks_json` text DEFAULT '[]' NOT NULL,
	`reserved_bytes` integer DEFAULT 0 NOT NULL,
	`raw_bytes` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`workspace_id`,`grant_id`) REFERENCES `kids_google_calendars`(`owner_user_id`,`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`,`workspace_id`,`previous_effect_id`) REFERENCES `kids_google_effects`(`owner_user_id`,`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kids_google_effect_state" CHECK("kids_google_effects"."source_kind" IN ('context','google') AND "kids_google_effects"."mode" IN ('create','update') AND "kids_google_effects"."status" IN ('prepared','approved','unknown','linked','cancelled') AND "kids_google_effects"."revision">=1 AND "kids_google_effects"."created_revision">=1 AND "kids_google_effects"."epoch">=0 AND "kids_google_effects"."grant_revision">=1 AND "kids_google_effects"."service_revision">=1 AND (("kids_google_effects"."mode"='create' AND "kids_google_effects"."previous_effect_id" IS NULL AND "kids_google_effects"."before_json" IS NULL) OR ("kids_google_effects"."mode"='update' AND "kids_google_effects"."previous_effect_id" IS NOT NULL AND "kids_google_effects"."before_json" IS NOT NULL)) AND (("kids_google_effects"."status"='linked')=("kids_google_effects"."provider_event_id" IS NOT NULL)) AND (("kids_google_effects"."status" IN ('unknown','linked') AND "kids_google_effects"."approved_at" IS NOT NULL AND "kids_google_effects"."claim_id" IS NOT NULL AND "kids_google_effects"."claimed_at" IS NOT NULL) OR ("kids_google_effects"."status" NOT IN ('unknown','linked') AND "kids_google_effects"."claim_id" IS NULL AND "kids_google_effects"."claimed_at" IS NULL)) AND ("kids_google_effects"."status"<>'approved' OR "kids_google_effects"."approved_at" IS NOT NULL) AND "kids_google_effects"."expires_at"=CASE WHEN "kids_google_effects"."approved_at" IS NULL THEN "kids_google_effects"."created_at"+86400000 ELSE "kids_google_effects"."approved_at"+1800000 END),
	CONSTRAINT "kids_google_effect_hash" CHECK(length("kids_google_effects"."source_hash")=64 AND "kids_google_effects"."source_hash" NOT GLOB '*[^0-9a-f]*' AND length("kids_google_effects"."proposal_hash")=64 AND "kids_google_effects"."proposal_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "kids_google_effect_json" CHECK(json_valid("kids_google_effects"."source_snapshot_json") AND json_type("kids_google_effects"."source_snapshot_json")='object' AND json_valid("kids_google_effects"."payload_json") AND json_type("kids_google_effects"."payload_json")='object' AND ("kids_google_effects"."before_json" IS NULL OR (json_valid("kids_google_effects"."before_json") AND json_type("kids_google_effects"."before_json")='object')) AND json_valid("kids_google_effects"."read_json") AND json_type("kids_google_effects"."read_json") IN ('object','null') AND json_valid("kids_google_effects"."checks_json") AND json_type("kids_google_effects"."checks_json")='array' AND json_array_length("kids_google_effects"."checks_json")<=20 AND length(CAST("kids_google_effects"."checks_json" AS BLOB))<=524288 AND length(CAST("kids_google_effects"."source_snapshot_json" AS BLOB))<=32768),
	CONSTRAINT "kids_google_effect_bytes" CHECK("kids_google_effects"."reserved_bytes" IN (0,49152) AND "kids_google_effects"."raw_bytes"=512+length(CAST("kids_google_effects"."source_snapshot_json" AS BLOB))+length(CAST("kids_google_effects"."payload_json" AS BLOB))+length(CAST(COALESCE("kids_google_effects"."before_json",'') AS BLOB))+length(CAST("kids_google_effects"."read_json" AS BLOB))+length(CAST("kids_google_effects"."checks_json" AS BLOB))+"kids_google_effects"."reserved_bytes")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `kids_google_effect_owner` ON `kids_google_effects` (`owner_user_id`,`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `kids_google_effect_page` ON `kids_google_effects` (`owner_user_id`,`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `kids_google_effect_pending` ON `kids_google_effects` (`owner_user_id`,`workspace_id`,`source_kind`,`source_id`,`link_id`,`calendar_id`) WHERE "kids_google_effects"."status" IN ('prepared','approved','unknown');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `kids_google_effect_successor` ON `kids_google_effects` (`previous_effect_id`) WHERE "kids_google_effects"."previous_effect_id" IS NOT NULL AND "kids_google_effects"."status"<>'cancelled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `kids_google_effect_head` ON `kids_google_effects` (`owner_user_id`,`workspace_id`,`source_kind`,`source_id`,`link_id`,`calendar_id`,`created_revision`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS kids_google_effect_identity BEFORE UPDATE ON kids_google_effects WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.grant_id IS NOT OLD.grant_id OR NEW.grant_revision IS NOT OLD.grant_revision OR NEW.link_id IS NOT OLD.link_id OR NEW.calendar_id IS NOT OLD.calendar_id OR NEW.epoch IS NOT OLD.epoch OR NEW.service_grant_id IS NOT OLD.service_grant_id OR NEW.service_revision IS NOT OLD.service_revision OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_id IS NOT OLD.source_id OR NEW.source_snapshot_json IS NOT OLD.source_snapshot_json OR NEW.source_hash IS NOT OLD.source_hash OR NEW.mode IS NOT OLD.mode OR NEW.previous_effect_id IS NOT OLD.previous_effect_id OR NEW.reference IS NOT OLD.reference OR NEW.payload_json IS NOT OLD.payload_json OR NEW.before_json IS NOT OLD.before_json OR NEW.proposal_hash IS NOT OLD.proposal_hash OR NEW.created_revision IS NOT OLD.created_revision OR NEW.created_at IS NOT OLD.created_at OR NEW.revision<>OLD.revision+1 OR OLD.status IN ('linked','cancelled') OR NOT ((OLD.status='prepared' AND NEW.status IN ('approved','cancelled')) OR (OLD.status='approved' AND NEW.status IN ('unknown','cancelled')) OR (OLD.status='unknown' AND NEW.status IN ('unknown','linked'))) OR (OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT OLD.approved_at) OR (OLD.claim_id IS NOT NULL AND (NEW.claim_id IS NOT OLD.claim_id OR NEW.claimed_at IS NOT OLD.claimed_at))
BEGIN SELECT RAISE(ABORT,'immutable reviewed Calendar effect'); END;
