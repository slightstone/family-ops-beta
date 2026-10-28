CREATE TABLE kids_family_invites (
 id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, recipient_hash TEXT NOT NULL, label TEXT NOT NULL, hint TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('viewer','editor')), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 cancelled_at INTEGER, accepted_at INTEGER, accepted_by TEXT,
 FOREIGN KEY(owner_user_id,workspace_id) REFERENCES kids_state(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE kids_family_members (
 grant_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 member_user_id TEXT NOT NULL, recipient_hash TEXT NOT NULL, invitation_id TEXT NOT NULL UNIQUE, label TEXT NOT NULL, hint TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('viewer','editor')), revision INTEGER NOT NULL DEFAULT 1, joined_at INTEGER NOT NULL, revoked_at INTEGER,
 FOREIGN KEY(owner_user_id,workspace_id) REFERENCES kids_state(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX kids_family_active_member ON kids_family_members(installation_id,workspace_id,member_user_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE kids_family_operations (
 actor_id TEXT NOT NULL, operation_id TEXT NOT NULL, installation_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 kind TEXT NOT NULL, body_hash TEXT NOT NULL, result TEXT NOT NULL, nonce TEXT NOT NULL, committed_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,operation_id)
);
--> statement-breakpoint
CREATE TABLE kids_family_manual_audit (
 actor_id TEXT NOT NULL, operation_id TEXT NOT NULL, installation_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 grant_id TEXT NOT NULL, grant_revision INTEGER NOT NULL, action TEXT NOT NULL, board_revision INTEGER NOT NULL, committed_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,operation_id)
);
