-- Nullable additions preserve historical pending/completed authority exactly.
ALTER TABLE kids_hosted_removals ADD target_connection_id TEXT;
--> statement-breakpoint
ALTER TABLE kids_hosted_removals ADD connections_json TEXT;
--> statement-breakpoint
ALTER TABLE kids_hosted_removals ADD references_json TEXT;
--> statement-breakpoint
CREATE TRIGGER kids_removal_plan_immutable BEFORE UPDATE ON kids_hosted_removals
WHEN NEW.target_connection_id IS NOT OLD.target_connection_id OR NEW.connections_json IS NOT OLD.connections_json OR NEW.references_json IS NOT OLD.references_json
BEGIN SELECT RAISE(ABORT,'KIDS_REMOVAL_PLAN_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kids_removal_plan_insert BEFORE INSERT ON kids_hosted_removals BEGIN
 SELECT CASE WHEN NOT ((NEW.target_connection_id IS NULL AND NEW.connections_json IS NULL AND NEW.references_json IS NULL) OR (NEW.connections_json IS NOT NULL AND NEW.references_json IS NOT NULL AND json_valid(NEW.connections_json) AND json_valid(NEW.references_json))) THEN RAISE(ABORT,'KIDS_REMOVAL_PLAN_SHAPE') END;
 SELECT CASE WHEN NEW.connections_json IS NOT NULL AND (
 json_type(NEW.connections_json)<>'array' OR json_type(NEW.references_json)<>'array' OR json_array_length(NEW.connections_json) NOT BETWEEN 1 AND 2 OR json_array_length(NEW.references_json)<>json_array_length(NEW.connections_json)
 OR (SELECT COUNT(DISTINCT json_extract(value,'$.id')) FROM json_each(NEW.connections_json))<>json_array_length(NEW.connections_json)
 OR (SELECT COUNT(DISTINCT json_extract(value,'$.reference')) FROM json_each(NEW.references_json))<>json_array_length(NEW.references_json)
 OR (SELECT COUNT(DISTINCT json_extract(value,'$.connectionId')) FROM json_each(NEW.references_json))<>json_array_length(NEW.connections_json)
 OR (NEW.target_connection_id IS NOT NULL AND (json_array_length(NEW.connections_json)<>1 OR json_extract(NEW.connections_json,'$[0].id') IS NOT NEW.target_connection_id))
 OR EXISTS(SELECT 1 FROM json_each(NEW.connections_json) x WHERE NOT EXISTS(SELECT 1 FROM kids_source_connections s WHERE s.id=json_extract(x.value,'$.id') AND s.owner_user_id=NEW.owner_user_id AND s.workspace_id=NEW.workspace_id AND s.status IN ('reserved','connected') AND s.status=json_extract(x.value,'$.status') AND s.revision=json_extract(x.value,'$.revision') AND s.source_epoch=json_extract(x.value,'$.source_epoch') AND s.binding_id IS json_extract(x.value,'$.binding_id')))
 OR (NEW.target_connection_id IS NULL AND (SELECT COUNT(*) FROM kids_source_connections WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id AND status<>'removed')<>json_array_length(NEW.connections_json))
 OR (SELECT COUNT(*) FROM json_each(NEW.connections_json) WHERE json_extract(value,'$.binding_id') IS NOT NULL)<>json_array_length(NEW.bindings_json)
 OR (SELECT COUNT(DISTINCT json_extract(value,'$.id')) FROM json_each(NEW.bindings_json))<>json_array_length(NEW.bindings_json)
 OR NEW.auth_cutoff<>(SELECT COALESCE(MAX(rowid),0) FROM kids_hosted_auth WHERE owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id)
 OR EXISTS(SELECT 1 FROM json_each(NEW.bindings_json) x WHERE NOT EXISTS(SELECT 1 FROM kids_hosted_bindings b JOIN json_each(NEW.connections_json) s ON json_extract(s.value,'$.binding_id')=b.id WHERE b.owner_user_id=NEW.owner_user_id AND b.workspace_id=NEW.workspace_id AND b.id=json_extract(x.value,'$.id') AND b.revision=json_extract(x.value,'$.revision') AND b.scope_id=json_extract(x.value,'$.scope_id') AND b.account_id=json_extract(x.value,'$.account_id') AND b.provider_identity_hash=json_extract(x.value,'$.provider_identity_hash') AND b.removed_at IS NULL))
 OR NEW.wait_until IS NOT (SELECT COALESCE(MAX(MAX(COALESCE(json_extract(a.value,'$.expiresAt'),0),COALESCE(json_extract(a.value,'$.leaseUntil'),0),0)),0) FROM json_each(NEW.references_json) x,json_each(x.value,'$.auth') a)
 OR EXISTS(SELECT 1 FROM json_each(NEW.references_json) x WHERE json_type(x.value,'$.auth') IS NOT 'array' OR (SELECT COUNT(DISTINCT json_extract(value,'$.rowid')) FROM json_each(x.value,'$.auth'))<>json_array_length(x.value,'$.auth')
  OR EXISTS(SELECT 1 FROM json_each(x.value,'$.auth') frozen WHERE NOT EXISTS(SELECT 1 FROM kids_hosted_auth a WHERE a.owner_user_id=NEW.owner_user_id AND a.workspace_id=NEW.workspace_id AND a.rowid=json_extract(frozen.value,'$.rowid') AND a.scope_reference=json_extract(x.value,'$.reference') AND a.scope_id IS json_extract(frozen.value,'$.scopeId') AND a.candidate_account_id IS json_extract(frozen.value,'$.candidateAccountId') AND a.expires_at=json_extract(frozen.value,'$.expiresAt') AND a.lease_until IS json_extract(frozen.value,'$.leaseUntil') AND (a.slot_id=json_extract(x.value,'$.connectionId') OR EXISTS(SELECT 1 FROM json_each(NEW.bindings_json) b WHERE json_extract(b.value,'$.id')=json_extract(x.value,'$.connectionId') AND (a.binding_id=json_extract(b.value,'$.id') OR a.verified_binding_id=json_extract(b.value,'$.id') OR (a.slot_id IS NULL AND a.scope_id=json_extract(b.value,'$.scope_id')))))))
  OR EXISTS(SELECT 1 FROM kids_hosted_auth a WHERE a.owner_user_id=NEW.owner_user_id AND a.workspace_id=NEW.workspace_id AND (a.slot_id=json_extract(x.value,'$.connectionId') OR EXISTS(SELECT 1 FROM json_each(NEW.bindings_json) b WHERE json_extract(b.value,'$.id')=json_extract(x.value,'$.connectionId') AND (a.binding_id=json_extract(b.value,'$.id') OR a.verified_binding_id=json_extract(b.value,'$.id') OR (a.slot_id IS NULL AND a.scope_id=json_extract(b.value,'$.scope_id'))))) AND NOT EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=a.owner_user_id AND r.workspace_id=a.workspace_id AND r.status='completed' AND r.auth_cutoff>=a.rowid AND (r.connections_json IS NULL OR EXISTS(SELECT 1 FROM json_each(r.connections_json) s WHERE json_extract(s.value,'$.id')=a.slot_id OR json_extract(s.value,'$.binding_id')=a.binding_id OR json_extract(s.value,'$.binding_id')=a.verified_binding_id OR (a.slot_id IS NULL AND EXISTS(SELECT 1 FROM json_each(r.bindings_json) b WHERE json_extract(b.value,'$.id')=json_extract(s.value,'$.binding_id') AND json_extract(b.value,'$.scope_id')=a.scope_id)))))
   AND NOT EXISTS(SELECT 1 FROM json_each(x.value,'$.auth') frozen WHERE json_extract(frozen.value,'$.rowid')=a.rowid)))
 OR EXISTS(SELECT 1 FROM json_each(NEW.references_json) x WHERE
  json_extract(x.value,'$.candidateAccountId') IS NOT (SELECT MAX(json_extract(value,'$.candidateAccountId')) FROM json_each(x.value,'$.auth'))
  OR (SELECT COUNT(DISTINCT json_extract(value,'$.candidateAccountId')) FROM json_each(x.value,'$.auth'))>1
  OR json_extract(x.value,'$.search') IS NOT (CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(NEW.bindings_json) b WHERE json_extract(b.value,'$.id')=json_extract(x.value,'$.connectionId')) OR EXISTS(SELECT 1 FROM json_each(x.value,'$.auth') a WHERE json_extract(a.value,'$.scopeId') IS NULL) THEN 1 ELSE 0 END)
  OR EXISTS(SELECT 1 FROM json_each(x.value,'$.auth') a WHERE json_extract(a.value,'$.scopeId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM json_each(x.value,'$.scopeIds') si WHERE si.value=json_extract(a.value,'$.scopeId')))
  OR EXISTS(SELECT 1 FROM json_each(NEW.bindings_json) b WHERE json_extract(b.value,'$.id')=json_extract(x.value,'$.connectionId') AND NOT EXISTS(SELECT 1 FROM json_each(x.value,'$.scopeIds') si WHERE si.value=json_extract(b.value,'$.scope_id'))))
 OR EXISTS(SELECT 1 FROM json_each(NEW.references_json) x WHERE x.type<>'object' OR json_type(x.value,'$.connectionId') IS NOT 'text' OR json_type(x.value,'$.reference') IS NOT 'text' OR json_type(x.value,'$.candidateAccountId') NOT IN ('text','null') OR json_type(x.value,'$.candidateAccountId') IS NULL OR json_type(x.value,'$.scopeIds') IS NOT 'array' OR json_array_length(x.value,'$.scopeIds')>1 OR COALESCE(json_type(x.value,'$.search'),'') NOT IN ('true','false') OR NOT EXISTS(SELECT 1 FROM json_each(NEW.connections_json) s WHERE json_extract(s.value,'$.id')=json_extract(x.value,'$.connectionId'))
  OR (json_extract(x.value,'$.reference') IS NOT 'familyops:'||NEW.workspace_id||':slot:'||json_extract(x.value,'$.connectionId') AND NOT (json_extract(x.value,'$.reference')='familyops:'||NEW.workspace_id AND EXISTS(SELECT 1 FROM kids_hosted_auth a JOIN json_each(NEW.bindings_json) b ON json_extract(b.value,'$.scope_id')=a.scope_id WHERE a.owner_user_id=NEW.owner_user_id AND a.workspace_id=NEW.workspace_id AND a.scope_reference=json_extract(x.value,'$.reference') AND (a.verified_binding_id=json_extract(b.value,'$.id') OR a.binding_id=json_extract(b.value,'$.id') OR a.slot_id=json_extract(x.value,'$.connectionId')))))
  OR EXISTS(SELECT 1 FROM json_each(x.value,'$.scopeIds') si WHERE si.type<>'text' OR NOT (EXISTS(SELECT 1 FROM json_each(NEW.bindings_json) b WHERE json_extract(b.value,'$.scope_id')=si.value AND json_extract(b.value,'$.id')=json_extract(x.value,'$.connectionId')) OR EXISTS(SELECT 1 FROM kids_hosted_auth a WHERE a.owner_user_id=NEW.owner_user_id AND a.workspace_id=NEW.workspace_id AND a.slot_id=json_extract(x.value,'$.connectionId') AND a.scope_reference=json_extract(x.value,'$.reference') AND a.scope_id=si.value))))
 ) THEN RAISE(ABORT,'KIDS_REMOVAL_PLAN_AUTHORITY') END;
END;
--> statement-breakpoint
DROP TRIGGER kids_hosted_auth_removal_insert;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_auth_removal_insert BEFORE INSERT ON kids_hosted_auth
WHEN EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.status<>'completed' AND (r.target_connection_id IS NULL OR r.target_connection_id=NEW.slot_id OR EXISTS(SELECT 1 FROM json_each(r.bindings_json) b WHERE json_extract(b.value,'$.id')=NEW.binding_id OR json_extract(b.value,'$.id')=NEW.verified_binding_id)))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_REMOVAL_PENDING'); END;
--> statement-breakpoint
DROP TRIGGER kids_hosted_auth_removal_complete;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_auth_removal_complete BEFORE UPDATE OF status ON kids_hosted_auth
WHEN NEW.status='connected' AND EXISTS(SELECT 1 FROM kids_hosted_removals r JOIN kids_hosted_auth a ON a.rowid=OLD.rowid WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND (r.status<>'completed' OR OLD.rowid<=r.auth_cutoff) AND (r.connections_json IS NULL OR EXISTS(SELECT 1 FROM json_each(r.connections_json) s WHERE json_extract(s.value,'$.id')=a.slot_id OR json_extract(s.value,'$.binding_id')=a.binding_id OR json_extract(s.value,'$.binding_id')=a.verified_binding_id OR (a.slot_id IS NULL AND EXISTS(SELECT 1 FROM json_each(r.bindings_json) b WHERE json_extract(b.value,'$.id')=json_extract(s.value,'$.binding_id') AND json_extract(b.value,'$.scope_id')=a.scope_id)))))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_REMOVAL_PENDING'); END;
--> statement-breakpoint
DROP TRIGGER kids_hosted_binding_removal_insert;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_binding_removal_insert BEFORE INSERT ON kids_hosted_bindings
WHEN EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=NEW.owner_user_id AND r.workspace_id=NEW.workspace_id AND r.status<>'completed' AND (r.target_connection_id IS NULL OR r.target_connection_id=NEW.id))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_REMOVAL_PENDING'); END;
--> statement-breakpoint
DROP TRIGGER kids_hosted_unlink_before_delete;
--> statement-breakpoint
CREATE TRIGGER kids_hosted_unlink_before_delete BEFORE DELETE ON kids_state
WHEN EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.owner_user_id=OLD.user_id AND b.workspace_id=OLD.id AND b.removed_at IS NULL)
 OR EXISTS(SELECT 1 FROM kids_source_connections s WHERE s.owner_user_id=OLD.user_id AND s.workspace_id=OLD.id AND s.status<>'removed')
 OR EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=OLD.user_id AND r.workspace_id=OLD.id AND r.status<>'completed')
 OR EXISTS(SELECT 1 FROM kids_hosted_auth a WHERE a.owner_user_id=OLD.user_id AND a.workspace_id=OLD.id AND NOT EXISTS(SELECT 1 FROM kids_hosted_removals r WHERE r.owner_user_id=OLD.user_id AND r.workspace_id=OLD.id AND r.status='completed' AND r.auth_cutoff>=a.rowid AND (r.connections_json IS NULL OR EXISTS(SELECT 1 FROM json_each(r.connections_json) s WHERE json_extract(s.value,'$.id')=a.slot_id OR json_extract(s.value,'$.binding_id')=a.binding_id OR json_extract(s.value,'$.binding_id')=a.verified_binding_id OR (a.slot_id IS NULL AND EXISTS(SELECT 1 FROM json_each(r.bindings_json) b WHERE json_extract(b.value,'$.id')=json_extract(s.value,'$.binding_id') AND json_extract(b.value,'$.scope_id')=a.scope_id))))))
BEGIN SELECT RAISE(ABORT,'KIDS_HOSTED_UNLINK_FIRST'); END;
--> statement-breakpoint
CREATE TRIGGER kids_connection_removal_proof BEFORE UPDATE OF status ON kids_source_connections
WHEN OLD.status<>'removed' AND NEW.status='removed' AND NOT EXISTS(SELECT 1 FROM kids_hosted_removals r,json_each(r.connections_json) s WHERE r.owner_user_id=OLD.owner_user_id AND r.workspace_id=OLD.workspace_id AND r.status='completed' AND json_extract(s.value,'$.id')=OLD.id AND json_extract(s.value,'$.revision')+1=OLD.revision AND json_extract(s.value,'$.source_epoch')+1=OLD.source_epoch AND OLD.paused=1 AND NEW.paused=1 AND NEW.discovery_consent=0 AND NEW.processing_consent=0)
BEGIN SELECT RAISE(ABORT,'KIDS_CONNECTION_REMOVAL_UNCONFIRMED'); END;
