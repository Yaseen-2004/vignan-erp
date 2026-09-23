import { Router } from 'express';
import { z } from 'zod';
import { Class, Event, ExamSubject, Faculty, Message, Notification, Role, Student, User, byCollection } from '../db/mongo/models.js';
import { oid } from '../db/mongo/connection.js';
import { lift, plain, populateFor } from '../db/mongo/query.js';
import { sameId } from '../lib/scope.js';
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
async function visibilityFilter(req, publishColumn = 'is_published') {
  if (isAdmin(req.user) || req.permissions.has('announcements.publish') || req.permissions.has('notices.publish')) {
    return null;
  }

  const targets = ['ALL'];
  /*
   * Anything addressed to this person's class or section as well as to their
   * group. The SQL built these as extra OR branches; they are the same
   * branches, collected.
   */
  const reaching = [];

  if (isStudent(req.user)) {
    targets.push('STUDENTS');
    const student = await Student.findOne({ user_id: oid(req.user.id) })
      .select('class_id section_id').lean();
    if (student) {
      if (student.class_id) reaching.push({ target_type: 'CLASS', target_class_id: student.class_id });
      if (student.section_id) reaching.push({ target_type: 'SECTION', target_section_id: student.section_id });
    }
  } else if (isParent(req.user)) {
    targets.push('PARENTS');
    const children = await childrenOf(req.user);
    const classIds = children.map((c) => oid(c.class_id)).filter(Boolean);
    const sectionIds = children.map((c) => oid(c.section_id)).filter(Boolean);
    if (classIds.length) reaching.push({ target_type: 'CLASS', target_class_id: { $in: classIds } });
    if (sectionIds.length) reaching.push({ target_type: 'SECTION', target_section_id: { $in: sectionIds } });
  } else if (isTeacher(req.user)) {
    targets.push('FACULTY', 'TEACHING_STAFF');
  } else if (isFinancial(req.user)) {
    targets.push('FACULTY', 'FINANCIAL_STAFF');
  } else {
    targets.push('ADMINISTRATORS');
  }

  // Published, and addressed to one of the groups this person belongs to.
  return {
    [publishColumn]: 1,
    $or: [{ target_type: { $in: targets } }, ...reaching],
  };
}

/** Shared factory for announcements / notices / circulars. */
function broadcastRouter({ table, module, entityType, dateColumn, extraColumns = '' }) {
  const resource = createResourceRouter({
    table,
    module,
    entityType,
    populate: {
      created_by: { full_name: 'created_by_name' },
      target_class_id: { name: 'target_class_name' },
      target_section_id: { name: 'target_section_name' },
    },
    searchable: ['title', 'content'],
    filterable: ['target_type', 'is_published', 'target_class_id', 'target_section_id'],
    sortable: ['id', dateColumn, 'created_at'],
    required: ['title', 'content'],
    defaultSort: dateColumn,
    scopeFilter: (req) => visibilityFilter(req),
  });

  /** Publish and fan out notifications to the selected audience. */
  resource.post(
    `/:id/publish`,
    requirePermission(`${module}.publish`),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      const Model = byCollection[table];
      const row = plain(await Model.findById(oid(id)));
      if (!row) throw notFound(`${entityType} not found`);
      if (!isAdmin(req.user) && !sameId(row.campus_id, req.user.campus_id)) throw forbidden('Different campus');

      const publish = req.body?.publish === false ? 0 : 1;
      await Model.updateOne({ _id: oid(id) }, { $set: { is_published: publish } });

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
    // BETWEEN over dates stored as text: the format sorts with the days, and
    // the upper bound carries a suffix so the last day is included whole.
    const between = (field) => ({ [field]: { $gte: from, $lte: `${to}\uffff` } });

    const events = plain(
      await Event.find({
        campus_id: oid(campusId),
        ...between('start_date'),
        ...(publishedOnly ? { is_published: 1 } : {}),
      })
        .select('title description event_type start_date end_date start_time end_time venue')
        .sort({ start_date: 1 })
    );

    const examDocs = await ExamSubject.find({ campus_id: oid(campusId), ...between('exam_date') })
      .select('exam_date start_time end_time room examination_id course_id class_id')
      .populate('examination_id', 'name')
      .populate({ path: 'course_id', select: 'subject_id class_id', populate: { path: 'subject_id', select: 'name' } })
      .populate('class_id', 'name')
      .sort({ exam_date: 1 });

    // A class is taken from the paper when it names one, and otherwise from
    // the course — which is what COALESCE(es.class_id, co.class_id) said.
    const courseClassIds = examDocs
      .filter((x) => !x.class_id && x.course_id?.class_id)
      .map((x) => x.course_id.class_id);
    const courseClasses = courseClassIds.length
      ? await Class.find({ _id: { $in: courseClassIds } }).select('name').lean()
      : [];
    const classNameFor = new Map(courseClasses.map((c) => [String(c._id), c.name]));

    const exams = examDocs.map((x) => ({
      id: String(x._id),
      start_date: x.exam_date,
      start_time: x.start_time,
      end_time: x.end_time,
      room: x.room,
      exam_name: x.examination_id?.name ?? null,
      subject_name: x.course_id?.subject_id?.name ?? null,
      class_name: x.class_id?.name ?? classNameFor.get(String(x.course_id?.class_id)) ?? null,
    }));

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

    /*
     * Deleting a message hides it from the person who deleted it, not from the
     * other party — each side has its own flag, and which one applies depends
     * on which box is open.
     */
    const filter = box === 'sent'
      ? { sender_id: oid(req.user.id), sender_deleted: 0 }
      : { recipient_id: oid(req.user.id), recipient_deleted: 0 };
    if (req.query.unread === 'true' && box === 'inbox') filter.is_read = 0;

    const MAPPING = {
      sender_id: { full_name: 'sender_name', photo: 'sender_photo' },
      'sender_id.role_id': { code: 'sender_role' },
      recipient_id: { full_name: 'recipient_name' },
      'recipient_id.role_id': { code: 'recipient_role' },
      context_student_id: { first_name: 'context_student_name' },
    };

    const [docs, total] = await Promise.all([
      Message.find(filter)
        .populate(populateFor(MAPPING))
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit),
      Message.countDocuments(filter),
    ]);
    const rows = lift(docs, MAPPING);
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
    const askingIsFamily = isStudent(req.user) || isParent(req.user);

    const filter = { campus_id: oid(campusId), status: 'ACTIVE' };
    if (askingIsFamily) {
      // A family may only write to staff.
      const roles = await Role.find({
        code: { $in: ['TEACHING_STAFF', 'FINANCIAL_STAFF', 'ADMINISTRATOR', 'ADMIN'] },
      }).select('_id').lean();
      filter.role_id = { $in: roles.map((r) => r._id) };
    } else {
      filter._id = { $ne: oid(req.user.id) };
    }

    const docs = await User.find(filter)
      .select('full_name role_id')
      .populate('role_id', 'code level')
      .limit(askingIsFamily ? 0 : 500);

    // Staff carry a designation and a department; that is the only reason
    // faculty was joined at all, so it is fetched only when it will be shown.
    const staff = askingIsFamily
      ? await Faculty.find({ user_id: { $in: docs.map((d) => d._id) } })
        .select('user_id designation department_id')
        .populate('department_id', 'name')
      : [];
    const staffFor = new Map(staff.map((f) => [String(f.user_id), f]));

    const contacts = docs
      .map((u) => ({
        id: String(u._id),
        full_name: u.full_name,
        role: u.role_id?.code ?? null,
        designation: staffFor.get(String(u._id))?.designation ?? null,
        department_name: staffFor.get(String(u._id))?.department_id?.name ?? null,
        _level: u.role_id?.level ?? 0,
      }))
      // Seniority first, then by name — as ORDER BY r.level, u.full_name did.
      .sort((a, b) => a._level - b._level
        || String(a.full_name ?? '').localeCompare(String(b.full_name ?? '')))
      .map(({ _level, ...c }) => c);

    return ok(res, contacts);
  })
);

router.post(
  '/messages',
  requirePermission('messages.create'),
  validateBody(
    z.object({
      recipient_id: z.string().min(1),
      subject: z.string().min(1, 'Enter a subject').max(160),
      body: z.string().min(1, 'Enter a message').max(4000),
      context_student_id: z.string().optional().nullable(),
      parent_message_id: z.string().optional().nullable(),
    })
  ),
  asyncHandler(async (req, res) => {
    const recipientDoc = await User.findById(oid(req.body.recipient_id)).populate('role_id', 'code');
    const recipient = recipientDoc ? lift(recipientDoc, { role_id: { code: 'role_code' } }) : null;
    if (!recipient) throw notFound('Recipient not found');
    if (recipient.status !== 'ACTIVE') throw badRequest('That recipient is not active');
    if (!isAdmin(req.user) && !sameId(recipient.campus_id, req.user.campus_id)) {
      throw forbidden('You may only message people at your own campus');
    }

    // Students and parents may only write to staff.
    if ((isStudent(req.user) || isParent(req.user)) && ['STUDENT', 'PARENT'].includes(recipient.role_code)) {
      throw forbidden('You may only message school staff');
    }
    // A parent may only attach one of their own children as context.
    if (req.body.context_student_id && isParent(req.user)) {
      const children = (await childrenOf(req.user)).map((c) => c.id);
      if (!children.some((c) => sameId(c, req.body.context_student_id))) throw forbidden('That is not your child');
    }

    const id = String((await Message.create({
      campus_id: oid(req.user.campus_id),
      sender_id: oid(req.user.id),
      recipient_id: oid(recipient.id),
      parent_message_id: oid(req.body.parent_message_id),
      subject: req.body.subject,
      body: req.body.body,
      context_student_id: oid(req.body.context_student_id),
    }))._id);

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
    return created(res, plain(await Message.findById(oid(id))));
  })
);

router.patch(
  '/messages/:id/read',
  requirePermission('messages.view'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const message = plain(await Message.findById(oid(id)));
    if (!message) throw notFound('Message not found');
    if (!sameId(message.recipient_id, req.user.id)) throw forbidden('This message is not addressed to you');
    await Message.updateOne({ _id: oid(id) }, {
      $set: { is_read: 1, read_at: new Date().toISOString().slice(0, 19).replace('T', ' ') },
    });
    return ok(res, { id, is_read: 1 });
  })
);

router.delete(
  '/messages/:id',
  requirePermission('messages.delete', 'messages.view'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const message = plain(await Message.findById(oid(id)));
    if (!message) throw notFound('Message not found');
    // Hidden from whoever deleted it; the other party still has their copy.
    if (sameId(message.recipient_id, req.user.id)) {
      await Message.updateOne({ _id: oid(id) }, { $set: { recipient_deleted: 1 } });
    } else if (sameId(message.sender_id, req.user.id)) {
      await Message.updateOne({ _id: oid(id) }, { $set: { sender_deleted: 1 } });
    } else {
      throw forbidden('This message is not yours');
    }
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
    const mine = { user_id: oid(req.user.id) };
    const filter = req.query.unread === 'true' ? { ...mine, is_read: 0 } : mine;

    const [docs, total, unread] = await Promise.all([
      Notification.find(filter).sort({ created_at: -1 }).skip(offset).limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...mine, is_read: 0 }),
    ]);
    const rows = plain(docs);
    return res.json({ data: rows, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), unread } });
  })
);

router.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) =>
    ok(res, { unread: await Notification.countDocuments({ user_id: oid(req.user.id), is_read: 0 }) })
  )
);

router.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const notification = plain(await Notification.findById(oid(id)));
    if (!notification) throw notFound('Notification not found');
    if (!sameId(notification.user_id, req.user.id)) throw forbidden('Not your notification');
    await Notification.updateOne({ _id: oid(id) }, {
      $set: { is_read: 1, read_at: new Date().toISOString().slice(0, 19).replace('T', ' ') },
    });
    return ok(res, { id, is_read: 1 });
  })
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    const changes = (await Notification.updateMany(
      { user_id: oid(req.user.id), is_read: 0 },
      { $set: { is_read: 1, read_at: new Date().toISOString().slice(0, 19).replace('T', ' ') } }
    )).modifiedCount;
    return ok(res, { updated: changes });
  })
);

router.delete(
  '/notifications/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const notification = plain(await Notification.findById(oid(id)));
    if (!notification) throw notFound('Notification not found');
    if (!sameId(notification.user_id, req.user.id)) throw forbidden('Not your notification');
    await Notification.deleteOne({ _id: oid(id) });
    return ok(res, { id, deleted: true });
  })
);

export default router;
