CREATE TABLE `kids_operation_receipts` (
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`body_hash` text NOT NULL,
	`committed_revision` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_user_id`, `workspace_id`, `operation_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kids_source_links` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`context_id` text NOT NULL,
	`task_id` text NOT NULL,
	`source_key` text NOT NULL,
	FOREIGN KEY (`owner_user_id`,`workspace_id`,`source_key`) REFERENCES `kids_source_records`(`owner_user_id`,`workspace_id`,`source_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_source_link_identity` ON `kids_source_links` (`owner_user_id`,`workspace_id`,`context_id`,`task_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `kids_source_link_order` ON `kids_source_links` (`owner_user_id`,`workspace_id`,`context_id`,`task_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `kids_source_records` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`source_key` text NOT NULL,
	`message_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`context_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`unread_media` integer NOT NULL,
	`source_json` text NOT NULL,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `kids_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kids_source_identity` ON `kids_source_records` (`owner_user_id`,`workspace_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `kids_source_context` ON `kids_source_records` (`owner_user_id`,`workspace_id`,`context_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `kids_source_chat` ON `kids_source_records` (`owner_user_id`,`workspace_id`,`chat_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `kids_source_media` ON `kids_source_records` (`owner_user_id`,`workspace_id`,`unread_media`,`chat_id`);--> statement-breakpoint
ALTER TABLE `kids_state` ADD `last_write_nonce` text DEFAULT '' NOT NULL;--> statement-breakpoint
INSERT INTO kids_source_records(owner_user_id,workspace_id,source_key,message_id,chat_id,context_id,fingerprint,unread_media,source_json)
SELECT k.user_id,k.id,json_extract(s.value,'$.key'),json_extract(s.value,'$.id'),json_extract(s.value,'$.chatId'),json_extract(s.value,'$.contextId'),json_extract(s.value,'$.fingerprint'),json_extract(s.value,'$.unreadMedia'),s.value
FROM kids_state k,json_each(k.document,'$.sources') s ORDER BY k.user_id,CAST(s.key AS INTEGER);
--> statement-breakpoint
-- Old receipts have no individual commit revision; preserve the hash, leave that unknown NULL.
INSERT INTO kids_operation_receipts(owner_user_id,workspace_id,operation_id,body_hash,committed_revision,created_at)
SELECT k.user_id,k.id,o.key,json_extract(o.value,'$.hash'),NULL,CAST((julianday(k.updated_at)-2440587.5)*86400000 AS INTEGER)
FROM kids_state k,json_each(k.operations) o;
--> statement-breakpoint
INSERT INTO kids_source_links(owner_user_id,workspace_id,context_id,task_id,source_key)
SELECT k.user_id,k.id,json_extract(c.value,'$.id'),'',l.value FROM kids_state k,json_each(k.document,'$.contexts') c,json_each(c.value,'$.sourceIds') l
ORDER BY k.user_id,CAST(c.key AS INTEGER),CAST(l.key AS INTEGER);
--> statement-breakpoint
INSERT INTO kids_source_links(owner_user_id,workspace_id,context_id,task_id,source_key)
SELECT k.user_id,k.id,json_extract(c.value,'$.id'),json_extract(t.value,'$.id'),l.value FROM kids_state k,json_each(k.document,'$.contexts') c,json_each(c.value,'$.tasks') t,json_each(t.value,'$.sourceIds') l
ORDER BY k.user_id,CAST(c.key AS INTEGER),CAST(t.key AS INTEGER),CAST(l.key AS INTEGER);
--> statement-breakpoint
CREATE TRIGGER kids_source_link_immutable BEFORE UPDATE ON kids_source_links BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_LINK_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_source_identity_immutable BEFORE UPDATE ON kids_source_records
WHEN NEW.sequence<>OLD.sequence OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.source_key<>OLD.source_key OR NEW.message_id<>OLD.message_id OR NEW.chat_id<>OLD.chat_id
BEGIN SELECT RAISE(ABORT,'KIDS_SOURCE_IDENTITY_CHANGED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_operation_receipt_immutable BEFORE UPDATE ON kids_operation_receipts BEGIN SELECT RAISE(ABORT,'KIDS_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
-- Clear a legacy row only after exact copied evidence/receipts/links exist.
-- If an older writer raced migration, preserve its complete legacy cells. New code
-- fails visibly for that row and can still export it, rather than lose the work.
UPDATE kids_state AS k SET document=json_set(document,'$.sources',json('[]'),'$.contexts',json(COALESCE((SELECT json_group_array(json_set(c.value,'$.sourceIds',json('[]'),'$.tasks',json(COALESCE((SELECT json_group_array(json_set(t.value,'$.sourceIds',json('[]'))) FROM json_each(c.value,'$.tasks') t),'[]')))) FROM json_each(document,'$.contexts') c),'[]'))),operations='{}'
WHERE (json_array_length(k.document,'$.sources')>0 OR k.operations<>'{}' OR EXISTS(SELECT 1 FROM json_each(k.document,'$.contexts') c WHERE json_array_length(c.value,'$.sourceIds')>0) OR EXISTS(SELECT 1 FROM json_each(k.document,'$.contexts') c,json_each(c.value,'$.tasks') t WHERE json_array_length(t.value,'$.sourceIds')>0))
AND NOT EXISTS(SELECT 1 FROM json_each(k.document,'$.sources') s WHERE NOT EXISTS(SELECT 1 FROM kids_source_records r WHERE r.owner_user_id=k.user_id AND r.workspace_id=k.id AND r.source_key=json_extract(s.value,'$.key') AND json(r.source_json)=json(s.value)))
AND NOT EXISTS(SELECT 1 FROM json_each(k.operations) o WHERE NOT EXISTS(SELECT 1 FROM kids_operation_receipts r WHERE r.owner_user_id=k.user_id AND r.workspace_id=k.id AND r.operation_id=o.key AND r.body_hash=json_extract(o.value,'$.hash')))
AND NOT EXISTS(SELECT 1 FROM json_each(k.document,'$.contexts') c,json_each(c.value,'$.sourceIds') s WHERE NOT EXISTS(SELECT 1 FROM kids_source_links l WHERE l.owner_user_id=k.user_id AND l.workspace_id=k.id AND l.context_id=json_extract(c.value,'$.id') AND l.task_id='' AND l.source_key=s.value))
AND NOT EXISTS(SELECT 1 FROM json_each(k.document,'$.contexts') c,json_each(c.value,'$.tasks') t,json_each(t.value,'$.sourceIds') s WHERE NOT EXISTS(SELECT 1 FROM kids_source_links l WHERE l.owner_user_id=k.user_id AND l.workspace_id=k.id AND l.context_id=json_extract(c.value,'$.id') AND l.task_id=json_extract(t.value,'$.id') AND l.source_key=s.value));
