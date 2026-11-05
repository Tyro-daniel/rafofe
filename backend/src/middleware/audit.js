/**
 * Writes an audit_logs row. Called from inside the same DB transaction
 * as the action it's logging wherever possible, so the audit trail and
 * the action it describes can never diverge.
 */
async function logAudit(client, { actorId, action, entityType, entityId, before = null, after = null, ip = null }) {
  await client.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId, action, entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, ip]
  );
}

module.exports = { logAudit };
