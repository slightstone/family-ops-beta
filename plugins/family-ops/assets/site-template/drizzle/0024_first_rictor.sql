-- Additive: preserve populated auth rows and every existing identity/completion trigger.
ALTER TABLE kids_hosted_auth ADD recovery_of text;
--> statement-breakpoint
ALTER TABLE kids_hosted_auth ADD recovery_result text CONSTRAINT kids_hosted_auth_recovery_result CHECK(recovery_result IS NULL OR recovery_result IN ('checking','empty','ambiguous','incomplete','unavailable','candidate','verified'));
--> statement-breakpoint
CREATE TRIGGER kids_hosted_auth_recovery_identity BEFORE UPDATE ON kids_hosted_auth
WHEN NEW.recovery_of IS NOT OLD.recovery_of
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_AUTH_RECOVERY_IMMUTABLE'); END;
