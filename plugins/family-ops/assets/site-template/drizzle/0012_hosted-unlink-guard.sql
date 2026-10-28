-- Keep the recovery handle until the separate provider unlink workflow has
-- verified removal. This guard is unconditional, including paused/expired auth.
CREATE TRIGGER kids_hosted_unlink_before_delete BEFORE DELETE ON kids_state
WHEN EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.owner_user_id=OLD.user_id AND b.workspace_id=OLD.id)
 OR EXISTS(SELECT 1 FROM kids_hosted_auth a WHERE a.owner_user_id=OLD.user_id AND a.workspace_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_UNLINK_FIRST'); END;
