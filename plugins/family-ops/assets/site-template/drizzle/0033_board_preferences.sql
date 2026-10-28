CREATE TABLE kids_board_preferences (
 owner_user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 value TEXT NOT NULL CHECK(json_valid(value)), last_parent_operation_id TEXT NOT NULL,
 PRIMARY KEY(owner_user_id,workspace_id),
 FOREIGN KEY(owner_user_id,workspace_id) REFERENCES kids_state(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER kids_board_preferences_insert_guard BEFORE INSERT ON kids_board_preferences WHEN NOT EXISTS(
 SELECT 1 FROM kids_operation_receipts r JOIN kids_state k ON k.user_id=r.owner_user_id AND k.id=r.workspace_id
 WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.last_parent_operation_id AND r.committed_revision=k.revision
 AND CASE WHEN json_valid(r.source_authority) THEN json_extract(r.source_authority,'$.kind')='parent-board-preferences-v1' AND json_extract(r.source_authority,'$.preferences')=NEW.value ELSE 0 END
) BEGIN SELECT RAISE(ABORT,'KIDS_BOARD_PREFERENCES_RECEIPT_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_board_preferences_update_guard BEFORE UPDATE ON kids_board_preferences WHEN NOT EXISTS(
 SELECT 1 FROM kids_operation_receipts r JOIN kids_state k ON k.user_id=r.owner_user_id AND k.id=r.workspace_id
 WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.last_parent_operation_id AND r.committed_revision=k.revision
 AND CASE WHEN json_valid(r.source_authority) THEN json_extract(r.source_authority,'$.kind')='parent-board-preferences-v1' AND json_extract(r.source_authority,'$.preferences')=NEW.value ELSE 0 END
) BEGIN SELECT RAISE(ABORT,'KIDS_BOARD_PREFERENCES_RECEIPT_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_board_preferences_identity_guard BEFORE UPDATE ON kids_board_preferences WHEN OLD.owner_user_id<>NEW.owner_user_id OR OLD.workspace_id<>NEW.workspace_id BEGIN SELECT RAISE(ABORT,'KIDS_BOARD_PREFERENCES_IDENTITY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_board_preferences_delete_guard BEFORE DELETE ON kids_board_preferences WHEN EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id) BEGIN SELECT RAISE(ABORT,'KIDS_BOARD_PREFERENCES_PRESERVED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_board_preferences_receipt_delete_guard BEFORE DELETE ON kids_operation_receipts WHEN EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id) AND CASE WHEN json_valid(OLD.source_authority) THEN json_extract(OLD.source_authority,'$.kind')='parent-board-preferences-v1' ELSE 0 END BEGIN SELECT RAISE(ABORT,'KIDS_BOARD_PREFERENCES_RECEIPT_IMMUTABLE'); END;
