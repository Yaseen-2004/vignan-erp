import { ActivityLog } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';

/**
 * Write an entry to activity_logs. Never throws — an audit failure must not
 * break the operation being audited, but it is reported to the console.
 */
export async function logActivity({
  req,
  user,
  action,
  module,
  entityType,
  entityId,
  description,
  oldValues,
  newValues,
  status = 'SUCCESS',
}) {
  try {
    const actor = user || req?.user || null;
    await ActivityLog.create({
      campus_id: oid(actor?.campus_id) ?? null,
      user_id: oid(actor?.id) ?? null,
      user_name: actor?.full_name ?? actor?.username ?? 'SYSTEM',
      role_code: actor?.role_code ?? null,
      action,
      module: module ?? null,
      entity_type: entityType ?? null,
      // Kept as text: an audit entry points at a record in any collection, so
      // there is no one reference for it to be.
      entity_id: entityId == null ? null : String(entityId),
      description: description ?? null,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: newValues ? JSON.stringify(newValues) : null,
      ip_address: req?.ip ?? null,
      user_agent: req?.get?.('user-agent') ?? null,
      status,
    });
  } catch (error) {
    console.error('[audit] failed to record activity:', error.message);
  }
}

/** Only the fields that actually changed, for a compact before/after diff. */
export function diff(before, after) {
  if (!before) return { old: null, new: after };
  const oldValues = {};
  const newValues = {};
  for (const key of Object.keys(after || {})) {
    if (key === 'updated_at') continue;
    const from = before[key];
    const to = after[key];
    if (String(from ?? '') !== String(to ?? '')) {
      oldValues[key] = from ?? null;
      newValues[key] = to ?? null;
    }
  }
  return Object.keys(newValues).length ? { old: oldValues, new: newValues } : { old: null, new: null };
}
