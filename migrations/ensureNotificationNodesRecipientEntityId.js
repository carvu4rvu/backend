const pool = require('../config/db');

const ensureNotificationNodesRecipientEntityId = async () => {
  console.log('Checking for recipient_entity_id column in notification_nodes...');
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notification_nodes' AND column_name = 'recipient_entity_id';
    `);
    if (res.rows.length === 0) {
      console.log('Adding recipient_entity_id column...');
      await client.query(`
        ALTER TABLE notification_nodes
        ADD COLUMN IF NOT EXISTS recipient_entity_id TEXT NULL;
      `);
      console.log('recipient_entity_id column added successfully.');
    } else {
      console.log('recipient_entity_id column already exists.');
    }
  } catch (err) {
    console.error('Error ensuring recipient_entity_id column:', err);
  } finally {
    client.release();
  }
};

module.exports = ensureNotificationNodesRecipientEntityId;
