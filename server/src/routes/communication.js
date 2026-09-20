import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update, scalar } from '../db/connection.js';
import { asyncHandler, ok, created, pagination, paginated } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createResourceRouter } from '../lib/crud.js';
import { logActivity } from '../lib/audit.js';
import { notify, notifyMany, resolveAudience } from '../lib/notify.js';
import {
  devicesFor,
  publicKey,
  pushConfigured,
  pushToUser,
  removeSubscription,
  saveSubscription,
} from '../lib/push.js';
import {
  isAdmin, isStaff, isStudent, isParent, isTeacher, isFinancial,
  studentIdOf, childrenOf, facultyIdOf,
} from '../lib/scope.js';

const router = Router();

/**
 * Which broadcast rows may this user read?
 * Staff who can publish see everything (including drafts); everyone else sees
 * published rows addressed to them, to their role, or to their class/section.
 */
async function visibilityClause(req, alias, publishColumn = 'is_published') {
  if (isAdmin(req.user) || req.permissions.has('announcements.publish') || req.permissions.has('notices.publish')) {
    return null;
  }

  const targets = ['ALL'];
  const params = [];
  let extra = '';

  if (isStudent(req.user)) {
    targets.push('STUDENTS');
    const student = await get('SELECT class_id, section_id FROM students WHERE user_id = ?', [req.user.id]);
    if (student) {
      extra = ` OR (${alias}.target_type = 'CLASS' AND ${alias}.target_class_id = ?)
                OR (${alias}.target_type = 'SECTION' AND ${alias}.target_section_id = ?)`;
      params.push(student.class_id, student.section_id);
    }
  } else if (isParent(req.user)) {
    targets.push('PARENTS');
    const children = await childrenOf(req.user);
    if (children.length) {
      const classIds = children.map((c) => c.class_id).filter(Boolean);
      const sectionIds = children.map((c) => c.section_id).filter(Boolean);
      if (classIds.length) {
        extra += ` OR (${alias}.target_type = 'CLASS' AND ${alias}.target_class_id IN (${classIds.map(() => '?').join(',')}))`;
        params.push(...classIds);
      }
      if (sectionIds.length) {
        extra += ` OR (${alias}.target_type = 'SECTION' AND ${alias}.target_section_id IN (${sectionIds.map(() => '?').join(',')}))`;
        params.push(...sectionIds);
      }
    }
  } else if (isTeacher(req.user)) {
    targets.push('FACULTY', 'TEACHING_STAFF');
  } else if (isFinancial(req.user)) {
    targets.push('FACULTY', 'FINANCIAL_STAFF');
  } else {
    targets.push('ADMINISTRATORS');
  }

  const clause = `${alias}.${publishColumn} = 1 AND ((${alias}.target_type IN (${targets
    .map(() => '?')
    .join(',')}))${extra})`;
  return { clause, params: [...targets, ...params] };
}

/** Shared factory for announcements / notices / circulars. */
function broadcastRouter({ table, module, entityType, dateColumn, extraColumns = '' }) {
  const alias = 'b';
  const resource = createResourceRouter({
    table,
    module,
    entityType,
    alias,
    select: `${alias}.*, u.full_name AS created_by_name, c.name AS target_class_name, sec.name AS target_section_name${extraColumns}`,
    joins: `LEFT JOIN users u ON u.id = ${alias}.created_by
            LEFT JOIN classes c ON c.id = ${alias}.target_class_id
            LEFT JOIN sections sec ON sec.id = ${alias}.target_section_id`,
    searchable: [`${alias}.title`, `${alias}.content`],
    filterable: ['target_type', 'is_published', 'target_class_id', 'target_section_id'],
    sortable: ['id', dateColumn, 'created_at'],
    required: ['title', 'content'],
    defaultSort: dateColumn,
    scopeClause: async (req) => await visibilityClause(req, alias),
  });

  /** Publish and fan out notifications to the selected audience. */
  resource.post(
    `/:id/publish`,
    requirePermission(`${module}.publish`),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const row = await get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (!row) throw notFound(`${entityType} not found`);
      if (!isAdmin(req.user) && row.campus_id !== req.user.campus_id) throw forbidden('Different campus');

      const publish = req.body?.publish === false ? 0 : 1;
      await update(table, id, { is_published: publish });

      let recipients = 0;
      if (publish) {
        const audience = await resolveAudience({
          campusId: row.campus_id,
          targetType: row.target_type,
          classId: row.target_class_id,
          sectionId: row.target_section_id,
        });
        recipients = await notifyMany(audience, {
          campusId: row.campus_id,
          type: module.toUpperCase().replace(/S$/, ''),
          title: row.title,
          body: String(row.content).slice(0, 160),
          link: `/${module}`,
          entityType,
          entityId: id,
        });
      }

      await logActivity({
        req,
        action: publish ? 'PUBLISH' : 'UNPUBLISH',
        module,
        entityType,
        entityId: id,
        description: `${publish ? 'Published' : 'Unpublished'} ${entityType.toLowerCase()} "${row.title}"${
          publish ? ` to ${recipients} recipient(s)` : ''
        }`,
        oldValues: { is_published: row.is_published },
        newValues: { is_published: publish },
      });

      return ok(res, { id, is_published: publish, recipients });
    })
  );

  return resource;
}

router.use(
  '/announcements',
  broadcastRouter({
    table: 'announcements',
    module: 'announcements',
    entityType: 'Announcement',
    dateColumn: 'publish_date',
  })
);

router.use(
  '/notices',
  broadcastRouter({ table: 'notices', module: 'notices', entityType: 'Notice', dateColumn: 'notice_date' })
);

router.use(
  '/circulars',
  broadcastRouter({ table: 'circulars', module: 'circulars', entityType: 'Circular', dateColumn: 'issue_date' })
);

// ----------------------------------------------------------------- events
router.use(
  '/events',
  createResourceRouter({
    table: 'events',
    module: 'events',
    entityType: 'Event',
    alias: 'e',
    select: `e.*, u.full_name AS created_by_name`,
    joins: `LEFT JOIN users u ON u.id = e.created_by`,
    searchable: ['e.title', 'e.description', 'e.venue'],
    filterable: ['event_type', 'is_published', 'target_type'],
    sortable: ['id', 'start_date'],
    required: ['title', 'start_date'],
    defaultSort: 'start_date',
    scopeClause: (req) => {
      if (isStaff(req.user)) return null;
      return { clause: 'e.is_published = 1', params: [] };
    },
  })
);

/**
 * Academic calendar: events, holidays, exams and the caller's own timetable
 * anchors, merged into one feed.
 */
router.get(
  '/calendar',
  requirePermission('events.view'),
  asyncHandler(async (req, res) => {
    const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = req.query.to || new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
    const campusId = req.user.campus_id;

    const publishedOnly = isStaff(req.user) ? '' : ' AND is_published = 1';
    const events = await all(
      `SELECT id, title, description, event_type, start_date, end_date, start_time, end_time, venue
         FROM events
        WHERE campus_id = ? AND substr(start_date, 1, 10) BETWEEN ? AND ?${publishedOnly}
        ORDER BY start_date`,
      [campusId, from, to]
    );

    const exams = await all(
      `SELECT es.id, es.exam_date AS start_date, es.start_time, es.end_time, es.room,
              e.name AS exam_name, sub.name AS subject_name, c.name AS class_name
         FROM exam_subjects es
         JOIN examinations e ON e.id = es.examination_id
         JOIN courses co ON co.id = es.course_id
         JOIN subjects sub ON sub.id = co.subject_id
         LEFT JOIN classes c ON c.id = COALESCE(es.class_id, co.class_id)
        WHERE es.campus_id = ? AND substr(es.exam_date, 1, 10) BETWEEN ? AND ?
        ORDER BY es.exam_date`,
      [campusId, from, to]
    );

    const feed = [
      ...events.map((e) => ({
        id: `event-${e.id}`,
        type: e.event_type === 'HOLIDAY' ? 'HOLIDAY' : 'EVENT',
        title: e.title,
        date: e.start_date,
        endDate: e.end_date,
        time: e.start_time,
        venue: e.venue,
        description: e.description,
      })),
      ...exams.map((e) => ({
        id: `exam-${e.id}`,
        type: 'EXAM',
        title: `${e.exam_name} — ${e.subject_name}`,
        date: e.start_date,
        time: e.start_time,
        venue: e.room,
        description: e.class_name,
      })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return ok(res, { from, to, items: feed });
  })
);

// --------------------------------------------------------------- messages
router.get(
  '/messages',
  requirePermission('messages.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query, 20);
    const box = req.query.box === 'sent' ? 'sent' : 'inbox';

    const where =
      box === 'sent'
        ? 'm.sender_id = ? AND m.sender_deleted = 0'
        : 'm.recipient_id = ? AND m.recipient_deleted = 0';
    const params = [req.user.id];

    if (req.query.unread === 'true' && box === 'inbox') params.push();

    const filter = req.query.unread === 'true' && box === 'inbox' ? ' AND m.is_read = 0' : '';
    const total = Number(await scalar(`SELECT COUNT(*) AS n FROM messages m WHERE ${where}${filter}`, params));
    const rows = await all(
      `SELECT m.*, su.full_name AS sender_name, su.photo AS sender_photo, sr.code AS sender_role,
              ru.full_name AS recipient_name, rr.code AS recipient_role,
              st.first_name AS context_student_name
         FROM messages m
         JOIN users su ON su.id = m.sender_id
         JOIN roles sr ON sr.id = su.role_id
         JOIN users ru ON ru.id = m.recipient_id
         JOIN roles rr ON rr.id = ru.role_id
         LEFT JOIN students st ON st.id = m.context_student_id
        WHERE ${where}${filter}
        ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return paginated(res, rows, total, { page, limit });
  })
);

/**
 * Who may this user write to?
 * Parents and students may only contact staff; staff may contact anyone in
 * their campus. This is enforced again on send.
 */
router.get(
  '/messages/contacts',
  requirePermission('messages.create'),
  asyncHandler(async (req, res) => {
    const campusId = req.user.campus_id;
    let sql;
    const params = [campusId];

    if (isStudent(req.user) || isParent(req.user)) {
      sql = `SELECT u.id, u.full_name, r.code AS role, f.designation, d.name AS department_name
               FROM users u
               JOIN roles r ON r.id = u.role_id
               LEFT JOIN faculty f ON f.user_id = u.id
               LEFT JOIN departments d ON d.id = f.department_id
              WHERE u.campus_id = ? AND u.status = 'ACTIVE'
                AND r.code IN ('TEACHING_STAFF','FINANCIAL_STAFF','ADMINISTRATOR','ADMIN')
              ORDER BY r.level, u.full_name`;
    } else {
      sql = `SELECT u.id, u.full_name, r.code AS role, NULL AS designation, NULL AS department_name
               FROM users u JOIN roles r ON r.id = u.role_id
              WHERE u.campus_id = ? AND u.status = 'ACTIVE' AND u.id != ?
              ORDER BY r.level, u.full_name LIMIT 500`;
      params.push(req.user.id);
    }
    return ok(res, await all(sql, params));
  })
);

router.post(
  '/messages',
  requirePermission('messages.create'),
  validateBody(
    z.object({
      recipient_id: z.coerce.number().int().positive(),
      subject: z.string().min(1, 'Enter a subject').max(160),
      body: z.string().min(1, 'Enter a message').max(4000),
      context_student_id: z.coerce.number().int().positive().optional().nullable(),
      parent_message_id: z.coerce.number().int().positive().optional().nullable(),
    })
  ),
  asyncHandler(async (req, res) => {
    const recipient = await get(
      `SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [req.body.recipient_id]
    );
    if (!recipient) throw notFound('Recipient not found');
    if (recipient.status !== 'ACTIVE') throw badRequest('That recipient is not active');
    if (!isAdmin(req.user) && recipient.campus_id !== req.user.campus_id) {
      throw forbidden('You may only message people at your own campus');
    }

    // Students and parents may only write to staff.
    if ((isStudent(req.user) || isParent(req.user)) && ['STUDENT', 'PARENT'].includes(recipient.role_code)) {
      throw forbidden('You may only message school staff');
    }
    // A parent may only attach one of their own children as context.
    if (req.body.context_student_id && isParent(req.user)) {
      const children = (await childrenOf(req.user)).map((c) => c.id);
      if (!children.includes(Number(req.body.context_student_id))) throw forbidden('That is not your child');
    }

    const id = await insert('messages', {
      campus_id: req.user.campus_id,
      sender_id: req.user.id,
      recipient_id: recipient.id,
      parent_message_id: req.body.parent_message_id,
      subject: req.body.subject,
      body: req.body.body,
      context_student_id: req.body.context_student_id,
    });

    await notify({
      userId: recipient.id,
      campusId: req.user.campus_id,
      type: 'MESSAGE',
      title: `New message from ${req.user.full_name}`,
      body: req.body.subject,
      link: '/messages',
      entityType: 'Message',
      entityId: id,
    });

    await logActivity({
      req,
      action: 'CREATE',
      module: 'messages',
      entityType: 'Message',
      entityId: id,
      description: `Sent a message to ${recipient.full_name}`,
    });
    return created(res, await get('SELECT * FROM messages WHERE id = ?', [id]));
  })
);

router.patch(
  '/messages/:id/read',
  requirePermission('messages.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const message = await get('SELECT * FROM messages WHERE id = ?', [id]);
    if (!message) throw notFound('Message not found');
    if (message.recipient_id !== req.user.id) throw forbidden('This message is not addressed to you');
    await run("UPDATE messages SET is_read = 1, read_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [id]);
    return ok(res, { id, is_read: 1 });
  })
);

router.delete(
  '/messages/:id',
  requirePermission('messages.delete', 'messages.view'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const message = await get('SELECT * FROM messages WHERE id = ?', [id]);
    if (!message) throw notFound('Message not found');
    if (message.recipient_id === req.user.id) await run('UPDATE messages SET recipient_deleted = 1 WHERE id = ?', [id]);
    else if (message.sender_id === req.user.id) await run('UPDATE messages SET sender_deleted = 1 WHERE id = ?', [id]);
    else throw forbidden('This message is not yours');
    return ok(res, { id, deleted: true });
  })
);

// ------------------------------------------------------ device notifications
/**
 * Switching device notifications on is done by the browser, not by us: it asks
 * its push service for a subscription and hands us the result. All this side
 * does is say which key to ask with, remember what comes back, and forget it
 * again on request.
 *
 * Every one of these is about the caller's own devices. There is no route that
 * touches anybody else's, and no id is accepted from the client — the user is
 * taken from the session.
 */
router.get(
  '/push/key',
  asyncHandler(async (req, res) =>
    ok(res, {
      // Absent means push is not configured on this server; the client then
      // simply does not offer it rather than failing at the browser.
      publicKey: publicKey(),
      enabled: pushConfigured,
      devices: pushConfigured ? await devicesFor(req.user.id) : [],
    })
  )
);

router.post(
  '/push/subscribe',
  validateBody(
    z.object({
      endpoint: z.string().url().max(1000),
      keys: z.object({
        p256dh: z.string().min(10).max(255),
        auth: z.string().min(4).max(255),
      }),
    })
  ),
  asyncHandler(async (req, res) => {
    if (!pushConfigured) throw badRequest('Device notifications are not configured on this server');
    const endpoint = await saveSubscription(req.user.id, req.body, req.get('user-agent'));
    if (!endpoint) throw badRequest('That subscription is not usable');
    return ok(res, { subscribed: true, devices: await devicesFor(req.user.id) });
  })
);

router.post(
  '/push/unsubscribe',
  validateBody(z.object({ endpoint: z.string().url().max(1000) })),
  asyncHandler(async (req, res) => {
    const removed = await removeSubscription(req.user.id, req.body.endpoint);
    return ok(res, { removed, devices: await devicesFor(req.user.id) });
  })
);

/** Send a notification to the caller's own devices, to prove it works. */
router.post(
  '/push/test',
  asyncHandler(async (req, res) => {
    if (!pushConfigured) throw badRequest('Device notifications are not configured on this server');
    const delivered = await pushToUser(req.user.id, {
      type: 'INFO',
      title: 'Vignan ERP',
      body: 'Device notifications are working. This is a test.',
      link: '/notifications',
      tag: 'push-test',
    });
    return ok(res, { delivered });
  })
);

// ---------------------------------------------------------- notifications
router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query, 20);
    const unreadOnly = req.query.unread === 'true' ? ' AND is_read = 0' : '';
    const total = Number(await scalar(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?${unreadOnly}`, [req.user.id]));
    const rows = await all(
      `SELECT * FROM notifications WHERE user_id = ?${unreadOnly} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );
    const unread = Number(await scalar('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]));
    return res.json({ data: rows, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), unread } });
  })
);

router.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) =>
    ok(res, { unread: Number(await scalar('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id])) })
  )
);

router.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const notification = await get('SELECT * FROM notifications WHERE id = ?', [id]);
    if (!notification) throw notFound('Notification not found');
    if (notification.user_id !== req.user.id) throw forbidden('Not your notification');
    await run("UPDATE notifications SET is_read = 1, read_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?", [id]);
    return ok(res, { id, is_read: 1 });
  })
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    const changes = (await run("UPDATE notifications SET is_read = 1, read_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS') WHERE user_id = ? AND is_read = 0", [
      req.user.id,
    ])).changes;
    return ok(res, { updated: changes });
  })
);

router.delete(
  '/notifications/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const notification = await get('SELECT * FROM notifications WHERE id = ?', [id]);
    if (!notification) throw notFound('Notification not found');
    if (notification.user_id !== req.user.id) throw forbidden('Not your notification');
    await run('DELETE FROM notifications WHERE id = ?', [id]);
    return ok(res, { id, deleted: true });
  })
);

export default router;
