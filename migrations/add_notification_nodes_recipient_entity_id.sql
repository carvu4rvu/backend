-- Store entity IDs in notification_nodes: USN (students), alumni.id (alumni), company id (companies).
-- user_id remains for role-only users (e.g. Admin, VC) who have no details table.
ALTER TABLE notification_nodes
  ADD COLUMN IF NOT EXISTS recipient_entity_id TEXT NULL;

COMMENT ON COLUMN notification_nodes.recipient_entity_id IS 'Entity ID by role: student USN, alumni.id, companies.id (stored as text). NULL for role-only users.';
