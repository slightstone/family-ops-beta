CREATE TABLE kids_notice_reviews (
 owner_user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, context_id TEXT NOT NULL,
 version TEXT NOT NULL, acknowledged_at TEXT, cleared_at TEXT, last_parent_operation_id TEXT NOT NULL,
 PRIMARY KEY(owner_user_id,workspace_id,context_id),
 FOREIGN KEY(owner_user_id,workspace_id) REFERENCES kids_state(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER kids_notice_insert_guard BEFORE INSERT ON kids_notice_reviews WHEN NOT EXISTS(SELECT 1 FROM kids_operation_receipts r JOIN kids_state k ON k.user_id=r.owner_user_id AND k.id=r.workspace_id
 WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.last_parent_operation_id AND r.committed_revision=k.revision
 AND json_extract(r.source_authority,'$.kind')='parent-notice-review-v1'
 AND json_extract(r.source_authority,'$.contextId')=NEW.context_id
 AND json_extract(r.source_authority,'$.proof')=(SELECT json_group_array(json_array(source_key,fingerprint)) FROM (SELECT DISTINCT r.source_key,r.fingerprint FROM kids_source_links l JOIN kids_source_records r ON r.owner_user_id=l.owner_user_id AND r.workspace_id=l.workspace_id AND r.source_key=l.source_key WHERE l.owner_user_id=NEW.owner_user_id AND l.workspace_id=NEW.workspace_id AND l.context_id=NEW.context_id AND l.task_id='' ORDER BY r.source_key COLLATE BINARY,r.fingerprint COLLATE BINARY)) AND (SELECT json_group_array(json_array(source_key,fingerprint)) FROM (SELECT DISTINCT r.source_key,r.fingerprint FROM kids_source_links l JOIN kids_source_records r ON r.owner_user_id=l.owner_user_id AND r.workspace_id=l.workspace_id AND r.source_key=l.source_key WHERE l.owner_user_id=NEW.owner_user_id AND l.workspace_id=NEW.workspace_id AND l.context_id=NEW.context_id AND l.task_id='' ORDER BY r.source_key COLLATE BINARY,r.fingerprint COLLATE BINARY))<>'[]'
 AND json_extract(r.source_authority,'$.before')=CASE WHEN EXISTS(SELECT 1 FROM kids_notice_reviews n WHERE n.owner_user_id=NEW.owner_user_id AND n.workspace_id=NEW.workspace_id AND n.context_id=NEW.context_id) THEN (SELECT json_object('exists',json('true'),'version',version,'acknowledgedAt',acknowledged_at,'clearedAt',cleared_at,'lastActionId',last_parent_operation_id) FROM kids_notice_reviews n WHERE n.owner_user_id=NEW.owner_user_id AND n.workspace_id=NEW.workspace_id AND n.context_id=NEW.context_id) ELSE json_object('exists',json('false'),'version',json_extract(r.source_authority,'$.version'),'acknowledgedAt',NULL,'clearedAt',NULL,'lastActionId',NULL) END
 AND json_extract(r.source_authority,'$.after')=json_object('exists',json('true'),'version',NEW.version,'acknowledgedAt',NEW.acknowledged_at,'clearedAt',NEW.cleared_at,'lastActionId',NEW.last_parent_operation_id)
 AND EXISTS(SELECT 1 FROM json_each(k.document,'$.contexts') WHERE json_extract(value,'$.id')=NEW.context_id)) BEGIN SELECT RAISE(ABORT,'KIDS_NOTICE_RECEIPT_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_notice_update_guard BEFORE UPDATE ON kids_notice_reviews WHEN NOT EXISTS(SELECT 1 FROM kids_operation_receipts r JOIN kids_state k ON k.user_id=r.owner_user_id AND k.id=r.workspace_id
 WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.operation_id=NEW.last_parent_operation_id AND r.committed_revision=k.revision
 AND json_extract(r.source_authority,'$.kind')='parent-notice-review-v1'
 AND json_extract(r.source_authority,'$.contextId')=NEW.context_id
 AND json_extract(r.source_authority,'$.proof')=(SELECT json_group_array(json_array(source_key,fingerprint)) FROM (SELECT DISTINCT r.source_key,r.fingerprint FROM kids_source_links l JOIN kids_source_records r ON r.owner_user_id=l.owner_user_id AND r.workspace_id=l.workspace_id AND r.source_key=l.source_key WHERE l.owner_user_id=NEW.owner_user_id AND l.workspace_id=NEW.workspace_id AND l.context_id=NEW.context_id AND l.task_id='' ORDER BY r.source_key COLLATE BINARY,r.fingerprint COLLATE BINARY)) AND (SELECT json_group_array(json_array(source_key,fingerprint)) FROM (SELECT DISTINCT r.source_key,r.fingerprint FROM kids_source_links l JOIN kids_source_records r ON r.owner_user_id=l.owner_user_id AND r.workspace_id=l.workspace_id AND r.source_key=l.source_key WHERE l.owner_user_id=NEW.owner_user_id AND l.workspace_id=NEW.workspace_id AND l.context_id=NEW.context_id AND l.task_id='' ORDER BY r.source_key COLLATE BINARY,r.fingerprint COLLATE BINARY))<>'[]'
 AND json_extract(r.source_authority,'$.before')=CASE WHEN EXISTS(SELECT 1 FROM kids_notice_reviews n WHERE n.owner_user_id=NEW.owner_user_id AND n.workspace_id=NEW.workspace_id AND n.context_id=NEW.context_id) THEN (SELECT json_object('exists',json('true'),'version',version,'acknowledgedAt',acknowledged_at,'clearedAt',cleared_at,'lastActionId',last_parent_operation_id) FROM kids_notice_reviews n WHERE n.owner_user_id=NEW.owner_user_id AND n.workspace_id=NEW.workspace_id AND n.context_id=NEW.context_id) ELSE json_object('exists',json('false'),'version',json_extract(r.source_authority,'$.version'),'acknowledgedAt',NULL,'clearedAt',NULL,'lastActionId',NULL) END
 AND json_extract(r.source_authority,'$.after')=json_object('exists',json('true'),'version',NEW.version,'acknowledgedAt',NEW.acknowledged_at,'clearedAt',NEW.cleared_at,'lastActionId',NEW.last_parent_operation_id)
 AND EXISTS(SELECT 1 FROM json_each(k.document,'$.contexts') WHERE json_extract(value,'$.id')=NEW.context_id)) BEGIN SELECT RAISE(ABORT,'KIDS_NOTICE_RECEIPT_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_notice_receipt_delete_guard BEFORE DELETE ON kids_operation_receipts
 WHEN json_extract(CASE WHEN json_valid(OLD.source_authority) THEN OLD.source_authority ELSE '{}' END,'$.kind')='parent-notice-review-v1'
 AND EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id)
 BEGIN SELECT RAISE(ABORT,'KIDS_NOTICE_RECEIPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_notice_delete_guard BEFORE DELETE ON kids_notice_reviews
 WHEN EXISTS(SELECT 1 FROM kids_state WHERE user_id=OLD.owner_user_id AND id=OLD.workspace_id)
 BEGIN SELECT RAISE(ABORT,'KIDS_NOTICE_REVIEW_PRESERVED'); END;
--> statement-breakpoint
CREATE TRIGGER kids_notice_identity_guard BEFORE UPDATE ON kids_notice_reviews
 WHEN NEW.owner_user_id<>OLD.owner_user_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.context_id<>OLD.context_id
 BEGIN SELECT RAISE(ABORT,'KIDS_NOTICE_IDENTITY_IMMUTABLE'); END;
