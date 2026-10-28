CREATE TABLE `workspace_deletion_receipts` (
	`user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`base_revision` integer NOT NULL,
	`deleted_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `operation_id`)
);
--> statement-breakpoint
CREATE INDEX `deletion_receipts_expiry` ON `workspace_deletion_receipts` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `workspace_write_budget` (
	`user_id` text PRIMARY KEY NOT NULL,
	`write_times` text NOT NULL,
	`last_write_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `write_budget_expiry` ON `workspace_write_budget` (`last_write_at`);
--> statement-breakpoint
CREATE TRIGGER workspace_budget_before_insert BEFORE INSERT ON workspace_state
BEGIN
  SELECT RAISE(ABORT,'FAMILY_RATE_LIMIT') WHERE (
    SELECT COUNT(*) FROM json_each(COALESCE((SELECT write_times FROM workspace_write_budget WHERE user_id=NEW.user_id),'[]'))
    WHERE CAST(value AS INTEGER)>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-60000
  )>=60;
END;
--> statement-breakpoint
CREATE TRIGGER workspace_budget_after_insert AFTER INSERT ON workspace_state
BEGIN
  INSERT INTO workspace_write_budget (user_id,write_times,last_write_at)
  VALUES (NEW.user_id,json_array(CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  ON CONFLICT(user_id) DO UPDATE SET
    write_times=json_insert((SELECT json_group_array(value) FROM json_each(workspace_write_budget.write_times) WHERE CAST(value AS INTEGER)>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-60000),'$[#]',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),
    last_write_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
END;
--> statement-breakpoint
CREATE TRIGGER workspace_budget_before_update BEFORE UPDATE ON workspace_state
BEGIN
  SELECT RAISE(ABORT,'FAMILY_RATE_LIMIT') WHERE (
    SELECT COUNT(*) FROM json_each(COALESCE((SELECT write_times FROM workspace_write_budget WHERE user_id=NEW.user_id),'[]'))
    WHERE CAST(value AS INTEGER)>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-60000
  )>=60;
END;
--> statement-breakpoint
CREATE TRIGGER workspace_budget_after_update AFTER UPDATE ON workspace_state
BEGIN
  INSERT INTO workspace_write_budget (user_id,write_times,last_write_at)
  VALUES (NEW.user_id,json_array(CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  ON CONFLICT(user_id) DO UPDATE SET
    write_times=json_insert((SELECT json_group_array(value) FROM json_each(workspace_write_budget.write_times) WHERE CAST(value AS INTEGER)>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-60000),'$[#]',CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),
    last_write_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
END;
