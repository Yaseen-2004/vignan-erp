import { Administrator, Faculty, Notification, Parent, Student, StudentParent, User } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';
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
  const created = await Notification.create({
    user_id: oid(userId),
    campus_id: oid(campusId),
    type,
    title,
    body: body ?? null,
    link: link ?? null,
    entity_type: entityType ?? null,
    // Text, because a notification points at a record in any collection.
    entity_id: entityId == null ? null : String(entityId),
  });
  const id = String(created._id);

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
  const campus = oid(campusId);
  if (!campus) return [];

  /*
   * Each audience was a join from users to the record that makes someone a
   * pupil, a parent or a teacher. Asked in two steps here — find those
   * records, then the accounts they belong to — because that is what the join
   * did, and a $lookup written to look more like SQL would only disguise it.
   *
   * The two audiences that were UNIONs are unions still: a class means its
   * pupils *and* their parents, and a parent with two children in the class
   * must be told once, which is what the Set is for.
   */
  const activeUsers = async (userIds) => {
    if (!userIds.length) return [];
    const rows = await User.find({
      _id: { $in: userIds },
      campus_id: campus,
      status: 'ACTIVE',
    }).select('_id').lean();
    return rows.map((r) => String(r._id));
  };

  const userIdsOf = async (Model, filter) => {
    const rows = await Model.find(filter).select('user_id').lean();
    return rows.map((r) => r.user_id).filter(Boolean);
  };

  /** Parents of the pupils matching a filter — the second half of each UNION. */
  const parentsOfStudents = async (studentFilter) => {
    const students = await Student.find(studentFilter).select('_id').lean();
    if (!students.length) return [];
    const links = await StudentParent.find({ student_id: { $in: students.map((x) => x._id) } })
      .select('parent_id').lean();
    if (!links.length) return [];
    const parents = await Parent.find({ _id: { $in: links.map((l) => l.parent_id) } })
      .select('user_id').lean();
    return parents.map((p) => p.user_id).filter(Boolean);
  };

  switch (targetType) {
    case 'STUDENTS':
      return activeUsers(await userIdsOf(Student, {}));

    case 'PARENTS':
      return activeUsers(await userIdsOf(Parent, {}));

    case 'FACULTY':
      return activeUsers(await userIdsOf(Faculty, {}));

    case 'TEACHING_STAFF':
      return activeUsers(await userIdsOf(Faculty, { staff_type: 'TEACHING' }));

    case 'FINANCIAL_STAFF':
      return activeUsers(await userIdsOf(Faculty, { staff_type: 'FINANCIAL' }));

    case 'ADMINISTRATORS':
      return activeUsers(await userIdsOf(Administrator, {}));

    case 'CLASS': {
      const klass = oid(classId);
      if (!klass) return [];
      const [pupils, parents] = await Promise.all([
        userIdsOf(Student, { class_id: klass }),
        parentsOfStudents({ class_id: klass }),
      ]);
      return activeUsers([...pupils, ...parents]);
    }

    case 'SECTION': {
      const section = oid(sectionId);
      if (!section) return [];
      const [pupils, parents] = await Promise.all([
        userIdsOf(Student, { section_id: section }),
        parentsOfStudents({ section_id: section }),
      ]);
      return activeUsers([...pupils, ...parents]);
    }

    case 'ALL':
    default: {
      const rows = await User.find({ campus_id: campus, status: 'ACTIVE' }).select('_id').lean();
      return rows.map((r) => String(r._id));
    }
  }
}

