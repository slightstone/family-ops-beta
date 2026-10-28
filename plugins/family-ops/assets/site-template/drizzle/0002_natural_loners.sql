CREATE TABLE `workspace_access_budget` (
	`actor_id` text PRIMARY KEY NOT NULL,
	`write_times` text NOT NULL,
	`last_write_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `access_budget_expiry` ON `workspace_access_budget` (`last_write_at`);--> statement-breakpoint
CREATE TABLE `workspace_access_operations` (
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`kind` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`body_hash` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`committed_at` integer NOT NULL,
	PRIMARY KEY(`actor_id`, `operation_id`),
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `workspace_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_operation_expiry` ON `workspace_access_operations` (`committed_at`);--> statement-breakpoint
CREATE TABLE `workspace_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`recipient_hash` text NOT NULL,
	`label` text NOT NULL,
	`hint` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`cancelled_at` integer,
	`accepted_at` integer,
	`accepted_by` text,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `workspace_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invitations_token_hash_unique` ON `workspace_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitation_expiry` ON `workspace_invitations` (`expires_at`);--> statement-breakpoint
CREATE TABLE `workspace_memberships` (
	`member_user_id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`invitation_id` text NOT NULL,
	`label` text NOT NULL,
	`hint` text NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `workspace_invitations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`,`workspace_id`) REFERENCES `workspace_state`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "membership_not_self" CHECK("workspace_memberships"."member_user_id" <> "workspace_memberships"."owner_user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_memberships_grant_id_unique` ON `workspace_memberships` (`grant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_owner_identity` ON `workspace_state` (`user_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER access_validate BEFORE INSERT ON workspace_access_operations BEGIN
 SELECT RAISE(ABORT,'ACCESS_STALE') WHERE NEW.created_at<CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-600000 OR NEW.created_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+30000;
 SELECT RAISE(ABORT,'ACCESS_DENIED') WHERE NEW.kind NOT IN ('create','cancel','revoke','accept','leave') OR NOT (EXISTS(SELECT 1 FROM workspace_state w WHERE w.user_id=NEW.owner_user_id AND w.id=NEW.workspace_id));
 SELECT RAISE(ABORT,'ACCESS_DENIED') WHERE NEW.kind IN ('create','cancel','revoke') AND NOT (NEW.actor_id=NEW.owner_user_id AND EXISTS(SELECT 1 FROM workspace_state w WHERE w.user_id=NEW.owner_user_id AND w.id=NEW.workspace_id) AND NOT EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.member_user_id=NEW.actor_id) AND json_extract(NEW.payload,'$.grantId')=NEW.workspace_id);
 SELECT RAISE(ABORT,'ACCESS_RATE_LIMIT') WHERE (SELECT COUNT(*) FROM json_each(COALESCE((SELECT write_times FROM workspace_access_budget WHERE actor_id=NEW.actor_id),'[]')) WHERE CAST(value AS INTEGER)>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-60000)>=20;
 SELECT RAISE(ABORT,'ACCESS_SELF') WHERE NEW.kind='create' AND json_extract(NEW.payload,'$.recipientHash')=json_extract(NEW.payload,'$.actorHash');
 SELECT RAISE(ABORT,'ACCESS_INVITE_LIMIT') WHERE NEW.kind='create' AND (SELECT COUNT(*) FROM workspace_invitations WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND cancelled_at IS NULL AND accepted_at IS NULL AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))>=5;
 SELECT RAISE(ABORT,'ACCESS_DUPLICATE') WHERE NEW.kind='create' AND EXISTS(SELECT 1 FROM workspace_invitations WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND recipient_hash=json_extract(NEW.payload,'$.recipientHash') AND cancelled_at IS NULL AND accepted_at IS NULL AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
 SELECT RAISE(ABORT,'ACCESS_UNAVAILABLE') WHERE NEW.kind='cancel' AND NOT EXISTS(SELECT 1 FROM workspace_invitations i WHERE i.id=json_extract(NEW.payload,'$.invitationId') AND i.owner_user_id=NEW.owner_user_id AND i.workspace_id=NEW.workspace_id AND i.cancelled_at IS NULL AND i.accepted_at IS NULL);
 SELECT RAISE(ABORT,'ACCESS_UNAVAILABLE') WHERE NEW.kind='revoke' AND NOT EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.grant_id=json_extract(NEW.payload,'$.targetGrantId') AND m.owner_user_id=NEW.owner_user_id AND m.workspace_id=NEW.workspace_id);
 SELECT RAISE(ABORT,'ACCESS_UNAVAILABLE') WHERE NEW.kind='leave' AND NOT EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.grant_id=json_extract(NEW.payload,'$.grantId') AND m.owner_user_id=NEW.owner_user_id AND m.workspace_id=NEW.workspace_id AND m.member_user_id=NEW.actor_id);
 SELECT RAISE(ABORT,'ACCESS_UNAVAILABLE') WHERE NEW.kind='accept' AND (NEW.actor_id=NEW.owner_user_id OR NOT EXISTS(SELECT 1 FROM workspace_invitations i WHERE i.id=json_extract(NEW.payload,'$.invitationId') AND i.owner_user_id=NEW.owner_user_id AND i.workspace_id=NEW.workspace_id AND i.token_hash=json_extract(NEW.payload,'$.tokenHash') AND i.recipient_hash=json_extract(NEW.payload,'$.actorHash') AND i.expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND i.cancelled_at IS NULL AND i.accepted_at IS NULL));
 SELECT RAISE(ABORT,'ACCESS_ALREADY_JOINED') WHERE NEW.kind='accept' AND EXISTS(SELECT 1 FROM workspace_memberships WHERE member_user_id=NEW.actor_id);
 SELECT RAISE(ABORT,'ACCESS_MEMBER_LIMIT') WHERE NEW.kind='accept' AND (SELECT COUNT(*) FROM workspace_memberships WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id)>=5;
END;
--> statement-breakpoint
CREATE TRIGGER access_effect AFTER INSERT ON workspace_access_operations BEGIN
 INSERT INTO workspace_invitations(id,owner_user_id,workspace_id,token_hash,recipient_hash,label,hint,created_at,expires_at)
 SELECT json_extract(NEW.payload,'$.invitationId'),NEW.owner_user_id,NEW.workspace_id,json_extract(NEW.payload,'$.tokenHash'),json_extract(NEW.payload,'$.recipientHash'),json_extract(NEW.payload,'$.label'),json_extract(NEW.payload,'$.hint'),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+86400000 WHERE NEW.kind='create';
 UPDATE workspace_invitations SET cancelled_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE NEW.kind='cancel' AND id=json_extract(NEW.payload,'$.invitationId') AND owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id;
 UPDATE workspace_invitations SET accepted_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),accepted_by=NEW.actor_id WHERE NEW.kind='accept' AND id=json_extract(NEW.payload,'$.invitationId') AND owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id;
 INSERT INTO workspace_memberships(member_user_id,grant_id,owner_user_id,workspace_id,invitation_id,label,hint,joined_at)
 SELECT NEW.actor_id,json_extract(NEW.payload,'$.newGrantId'),NEW.owner_user_id,NEW.workspace_id,i.id,i.label,i.hint,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) FROM workspace_invitations i WHERE NEW.kind='accept' AND i.id=json_extract(NEW.payload,'$.invitationId') AND i.owner_user_id=NEW.owner_user_id AND i.workspace_id=NEW.workspace_id;
 DELETE FROM workspace_memberships WHERE NEW.kind='revoke' AND grant_id=json_extract(NEW.payload,'$.targetGrantId') AND owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id;
 DELETE FROM workspace_memberships WHERE NEW.kind='leave' AND member_user_id=NEW.actor_id AND grant_id=json_extract(NEW.payload,'$.grantId') AND owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id;
 INSERT INTO workspace_access_budget(actor_id,write_times,last_write_at) VALUES(NEW.actor_id,json_array(CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 ON CONFLICT(actor_id) DO UPDATE SET write_times=json_insert((SELECT json_group_array(value) FROM json_each(workspace_access_budget.write_times) WHERE CAST(value AS INTEGER)>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-60000),'$[#]',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),last_write_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
END;
--> statement-breakpoint
CREATE TRIGGER membership_scope BEFORE INSERT ON workspace_memberships BEGIN
 SELECT RAISE(ABORT,'ACCESS_DENIED') WHERE NOT EXISTS(SELECT 1 FROM workspace_invitations i WHERE i.id=NEW.invitation_id AND i.owner_user_id=NEW.owner_user_id AND i.workspace_id=NEW.workspace_id AND i.accepted_by=NEW.member_user_id AND i.accepted_at IS NOT NULL);
END;
