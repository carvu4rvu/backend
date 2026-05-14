-- Remove pin and highlight columns from notifications table.
ALTER TABLE notifications DROP COLUMN IF EXISTS is_pinned;
ALTER TABLE notifications DROP COLUMN IF EXISTS is_highlighted;
ALTER TABLE notifications DROP COLUMN IF EXISTS pin_until;
