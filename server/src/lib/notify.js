import { insert, all } from '../db/connection.js';
import { pushToUser } from './push.js';

/**
 * Create one notification.
 *
 * The row is the record — it is what the bell reads and what survives a device
 * being replaced. The push is a courtesy on top, sent to whichever devices the
 * person has switched on, and deliberately not awaited: a push service being
 * slow or unreachable must not hold up the marks approval that caused it, and
 * a device that never receives it still finds the notification waiting in the
 * portal.
 */
export async function notify({ userId, campusId = null, type, title, body, link, entityType, entityId }) {
  if (!userId) return null;
  const id = await insert('notifications', {
    user_id: userId,
    campus_id: campusId,
    type,
    title,
    body: body ?? null,
    link: link ?? null,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
  });

  pushToUser(userId, { type, title, body, link, entityType, entityId })
    .catch(() => { /* the record is written; delivery is best effort */ });

  return id;
}

/** Fan a notification out to many users. */
export async function notifyMany(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) await notify({ ...payload, userId });
  return unique.length;
}

/**
 * Resolve an audience selector (the same targets used by announcements,
 * notices and circulars) into concrete user ids.
 */
export async function resolveAudience({ campusId, targetType, classId, sectionId }) {
  const params = [campusId];
  let sql = '';
  switch (targetType) {
    case 'STUDENTS':
      sql = `SELECT u.id FROM users u JOIN students s ON s.user_id = u.id
              WHERE u.campus_id = ? AND u.status = 'ACTIVE'`;
      break;
    case 'PARENTS':
      sql = `SELECT u.id FROM users u JOIN parents p ON p.user_id = u.id
              WHERE u.campus_id = ? AND u.status = 'ACTIVE'`;
      break;
    case 'FACULTY':
      sql = `SELECT u.id FROM users u JOIN faculty f ON f.user_id = u.id
              WHERE u.campus_id = ? AND u.status = 'ACTIVE'`;
      break;
    case 'TEACHING_STAFF':
      sql = `SELECT u.id FROM users u JOIN faculty f ON f.user_id = u.id
              WHERE u.campus_id = ? AND f.staff_type = 'TEACHING' AND u.status = 'ACTIVE'`;
      break;
    case 'FINANCIAL_STAFF':
      sql = `SELECT u.id FROM users u JOIN faculty f ON f.user_id = u.id
              WHERE u.campus_id = ? AND f.staff_type = 'FINANCIAL' AND u.status = 'ACTIVE'`;
      break;
    case 'ADMINISTRATORS':
      sql = `SELECT u.id FROM users u JOIN administrators a ON a.user_id = u.id
              WHERE u.campus_id = ? AND u.status = 'ACTIVE'`;
      break;
    case 'CLASS':
      // Students of the class plus every linked parent.
      sql = `SELECT u.id FROM users u JOIN students s ON s.user_id = u.id
              WHERE u.campus_id = ? AND s.class_id = ? AND u.status = 'ACTIVE'
             UNION
             SELECT pu.id FROM users pu JOIN parents p ON p.user_id = pu.id
               JOIN student_parents sp ON sp.parent_id = p.id
               JOIN students s2 ON s2.id = sp.student_id
              WHERE pu.campus_id = ? AND s2.class_id = ? AND pu.status = 'ACTIVE'`;
      params.push(classId, campusId, classId);
      break;
    case 'SECTION':
      sql = `SELECT u.id FROM users u JOIN students s ON s.user_id = u.id
              WHERE u.campus_id = ? AND s.section_id = ? AND u.status = 'ACTIVE'
             UNION
             SELECT pu.id FROM users pu JOIN parents p ON p.user_id = pu.id
               JOIN student_parents sp ON sp.parent_id = p.id
               JOIN students s2 ON s2.id = sp.student_id
              WHERE pu.campus_id = ? AND s2.section_id = ? AND pu.status = 'ACTIVE'`;
      params.push(sectionId, campusId, sectionId);
      break;
    case 'ALL':
    default:
      sql = `SELECT id FROM users WHERE campus_id = ? AND status = 'ACTIVE'`;
  }
  return (await all(sql, params)).map((r) => r.id);
}
