CREATE TABLE `kids_school_assertions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`source_key` text NOT NULL,
	`context_id` text NOT NULL,
	`child_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`first` text NOT NULL,
	`last` text NOT NULL,
	`status` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`authority` text NOT NULL,
	`ignored` integer DEFAULT 0 NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`workspace_id`,`source_key`) REFERENCES `kids_source_records`(`owner_user_id`,`workspace_id`,`source_key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kids_school_assertion_value" CHECK("kids_school_assertions"."status" IN ('open','closed','changed_hours') AND "kids_school_assertions"."authority" IN ('reported','school') AND "kids_school_assertions"."ignored" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_school_assertion_identity` ON `kids_school_assertions` (`owner_user_id`,`workspace_id`,`source_key`,`context_id`,`child_id`);--> statement-breakpoint
CREATE TABLE `kids_school_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`child_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_revision` integer NOT NULL,
	`retired_at` integer,
	`retired_operation` text,
	FOREIGN KEY (`draft_id`) REFERENCES `kids_school_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_school_calendar_child` ON `kids_school_calendars` (`draft_id`,`child_id`);--> statement-breakpoint
CREATE TABLE `kids_school_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`proposal_hash` text NOT NULL,
	`source_hash` text NOT NULL,
	`source_text` text NOT NULL,
	`source_label` text NOT NULL,
	`source_url` text NOT NULL,
	`proposal_json` text NOT NULL,
	`raw_bytes` integer NOT NULL,
	`created_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`service_grant_id` text NOT NULL,
	`service_revision` integer NOT NULL,
	`applied_operation` text,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kids_school_draft_status" CHECK("kids_school_drafts"."status" IN ('pending','dismissed','applied')),
	CONSTRAINT "kids_school_draft_size" CHECK("kids_school_drafts"."raw_bytes">0 AND "kids_school_drafts"."raw_bytes"<=48000 AND "kids_school_drafts"."expires_at"="kids_school_drafts"."created_at"+604800000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_school_draft_operation` ON `kids_school_drafts` (`owner_user_id`,`workspace_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `kids_school_issues` (
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`source_key` text NOT NULL,
	`context_id` text NOT NULL,
	`child_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	`cleared_at` integer,
	PRIMARY KEY(`batch_id`, `source_key`, `context_id`, `child_id`),
	FOREIGN KEY (`batch_id`) REFERENCES `kids_hosted_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TRIGGER kids_school_draft_identity BEFORE UPDATE ON kids_school_drafts
WHEN OLD.status='applied' OR NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.request_hash IS NOT OLD.request_hash OR NEW.proposal_hash IS NOT OLD.proposal_hash OR NEW.source_hash IS NOT OLD.source_hash OR NEW.source_text IS NOT OLD.source_text OR NEW.source_label IS NOT OLD.source_label OR NEW.source_url IS NOT OLD.source_url OR NEW.proposal_json IS NOT OLD.proposal_json OR NEW.raw_bytes IS NOT OLD.raw_bytes OR NEW.created_revision IS NOT OLD.created_revision OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.service_grant_id IS NOT OLD.service_grant_id OR NEW.service_revision IS NOT OLD.service_revision
 OR NOT EXISTS(SELECT 1 FROM kids_operation_receipts r JOIN kids_state k ON k.user_id=r.owner_user_id AND k.id=r.workspace_id AND k.revision=r.committed_revision WHERE r.owner_user_id=OLD.owner_user_id AND r.workspace_id=OLD.workspace_id AND json_extract(r.source_authority,'$.kind')='parent-school-edit-v1' AND json_extract(r.source_authority,'$.draftId')=OLD.id AND (NEW.status='applied' AND r.operation_id=NEW.applied_operation AND json_extract(r.source_authority,'$.action')='confirm' OR NEW.status IN ('pending','dismissed') AND json_extract(r.source_authority,'$.action')='draftStatus'))
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_DRAFT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_version_identity BEFORE INSERT ON kids_school_calendars
WHEN NOT EXISTS(SELECT 1 FROM kids_school_drafts p JOIN kids_state k ON k.user_id=p.owner_user_id AND k.id=p.workspace_id JOIN kids_operation_receipts r ON r.owner_user_id=k.user_id AND r.workspace_id=k.id AND r.committed_revision=k.revision WHERE p.id=NEW.draft_id AND p.status='pending' AND p.owner_user_id=NEW.owner_user_id AND p.workspace_id=NEW.workspace_id AND NEW.created_revision=k.revision AND EXISTS(SELECT 1 FROM json_each(p.proposal_json,'$.childIds') c WHERE c.value=NEW.child_id) AND EXISTS(SELECT 1 FROM json_each(k.document,'$.children') c WHERE json_extract(c.value,'$.id')=NEW.child_id) AND json_extract(r.source_authority,'$.kind')='parent-school-edit-v1' AND json_extract(r.source_authority,'$.action')='confirm' AND json_extract(r.source_authority,'$.draftId')=p.id)
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_VERSION_IDENTITY'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_version_immutable BEFORE UPDATE ON kids_school_calendars
WHEN OLD.retired_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.draft_id IS NOT OLD.draft_id OR NEW.child_id IS NOT OLD.child_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_revision IS NOT OLD.created_revision OR NEW.retired_at IS NULL OR NEW.retired_operation IS NULL
 OR NOT EXISTS(SELECT 1 FROM kids_operation_receipts r JOIN kids_state k ON k.user_id=r.owner_user_id AND k.id=r.workspace_id AND k.revision=r.committed_revision,json_each(r.source_authority,'$.replaceIds') x WHERE r.owner_user_id=OLD.owner_user_id AND r.workspace_id=OLD.workspace_id AND r.operation_id=NEW.retired_operation AND json_extract(r.source_authority,'$.kind')='parent-school-edit-v1' AND json_extract(r.source_authority,'$.action')='confirm' AND x.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_VERSION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_assertion_identity BEFORE INSERT ON kids_school_assertions
WHEN ((SELECT COUNT(*) FROM kids_school_assertions WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id)>=5000 AND NOT EXISTS(SELECT 1 FROM kids_school_assertions a WHERE a.owner_user_id=NEW.owner_user_id AND a.workspace_id=NEW.workspace_id AND a.source_key=NEW.source_key AND a.context_id=NEW.context_id AND a.child_id=NEW.child_id))
 OR NOT EXISTS(SELECT 1 FROM kids_source_records s JOIN kids_state k ON k.user_id=s.owner_user_id AND k.id=s.workspace_id JOIN kids_operation_receipts r ON r.owner_user_id=k.user_id AND r.workspace_id=k.id AND r.committed_revision=k.revision JOIN kids_hosted_batches b ON b.id=json_extract(r.source_authority,'$.batchId') WHERE s.owner_user_id=NEW.owner_user_id AND s.workspace_id=NEW.workspace_id AND s.source_key=NEW.source_key AND s.fingerprint=NEW.fingerprint AND b.status='saved' AND json_extract(r.source_authority,'$.kind')='hosted-source-batch-v1' AND b.owner_user_id=k.user_id AND b.workspace_id=k.id AND (EXISTS(SELECT 1 FROM kids_hosted_batch_members m WHERE m.batch_id=b.id AND m.chat_id||':'||m.message_id=NEW.source_key AND m.fingerprint=NEW.fingerprint) OR EXISTS(SELECT 1 FROM kids_hosted_history_batch_members m WHERE m.batch_id=b.id AND m.chat_id||':'||m.message_id=NEW.source_key AND m.fingerprint=NEW.fingerprint)) AND EXISTS(SELECT 1 FROM kids_source_links l WHERE l.owner_user_id=k.user_id AND l.workspace_id=k.id AND l.context_id=NEW.context_id AND l.source_key=NEW.source_key AND l.task_id='') AND EXISTS(SELECT 1 FROM json_each(k.document,'$.contexts') c WHERE json_extract(c.value,'$.id')=NEW.context_id AND EXISTS(SELECT 1 FROM json_each(c.value,'$.childIds') p WHERE p.value=NEW.child_id)))
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_ASSERTION_IDENTITY'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_assertion_update BEFORE UPDATE ON kids_school_assertions
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.source_key IS NOT OLD.source_key OR NEW.context_id IS NOT OLD.context_id OR NEW.child_id IS NOT OLD.child_id OR NEW.revision<>OLD.revision+1
 OR NOT(
 (NEW.ignored=OLD.ignored AND EXISTS(SELECT 1 FROM kids_source_records s JOIN kids_state k ON k.user_id=s.owner_user_id AND k.id=s.workspace_id JOIN kids_operation_receipts r ON r.owner_user_id=k.user_id AND r.workspace_id=k.id AND r.committed_revision=k.revision JOIN kids_hosted_batches b ON b.id=json_extract(r.source_authority,'$.batchId') WHERE s.owner_user_id=NEW.owner_user_id AND s.workspace_id=NEW.workspace_id AND s.source_key=NEW.source_key AND s.fingerprint=NEW.fingerprint AND b.status='saved' AND json_extract(r.source_authority,'$.kind')='hosted-source-batch-v1' AND b.owner_user_id=k.user_id AND b.workspace_id=k.id AND (EXISTS(SELECT 1 FROM kids_hosted_batch_members m WHERE m.batch_id=b.id AND m.chat_id||':'||m.message_id=NEW.source_key AND m.fingerprint=NEW.fingerprint) OR EXISTS(SELECT 1 FROM kids_hosted_history_batch_members m WHERE m.batch_id=b.id AND m.chat_id||':'||m.message_id=NEW.source_key AND m.fingerprint=NEW.fingerprint)) AND EXISTS(SELECT 1 FROM kids_source_links l WHERE l.owner_user_id=k.user_id AND l.workspace_id=k.id AND l.context_id=NEW.context_id AND l.source_key=NEW.source_key AND l.task_id='')))
 OR (NEW.fingerprint=OLD.fingerprint AND NEW.first=OLD.first AND NEW.last=OLD.last AND NEW.status=OLD.status AND NEW.start_time=OLD.start_time AND NEW.end_time=OLD.end_time AND NEW.authority=OLD.authority AND EXISTS(SELECT 1 FROM kids_operation_receipts r JOIN kids_state k ON k.user_id=r.owner_user_id AND k.id=r.workspace_id AND k.revision=r.committed_revision WHERE r.owner_user_id=OLD.owner_user_id AND r.workspace_id=OLD.workspace_id AND json_extract(r.source_authority,'$.kind')='parent-school-edit-v1' AND json_extract(r.source_authority,'$.action')='ignore' AND json_extract(r.source_authority,'$.assertionId')=OLD.id)))
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_ASSERTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_children BEFORE UPDATE OF document ON kids_state
WHEN EXISTS(SELECT 1 FROM kids_school_calendars c WHERE c.owner_user_id=OLD.user_id AND c.workspace_id=OLD.id AND NOT EXISTS(SELECT 1 FROM json_each(NEW.document,'$.children') x WHERE json_extract(x.value,'$.id')=c.child_id))
 OR EXISTS(SELECT 1 FROM kids_school_assertions c WHERE c.owner_user_id=OLD.user_id AND c.workspace_id=OLD.id AND NOT EXISTS(SELECT 1 FROM json_each(NEW.document,'$.children') x WHERE json_extract(x.value,'$.id')=c.child_id))
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_CHILD_HISTORY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_draft_delete BEFORE DELETE ON kids_school_drafts WHEN EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id)
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_HISTORY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_calendar_delete BEFORE DELETE ON kids_school_calendars WHEN EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id)
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_HISTORY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_assertion_delete BEFORE DELETE ON kids_school_assertions WHEN EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id)
BEGIN SELECT RAISE(ABORT,'KIDS_SCHOOL_HISTORY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_school_source_batch_operation BEFORE INSERT ON kids_hosted_batches WHEN EXISTS(SELECT 1 FROM kids_operation_receipts r WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'KIDS_OPERATION_RESERVED'); END;
