/**
 * The generic resource router, against a real MongoDB.
 *
 * Forty-four resources are built on it, so a mistake here is made forty-four
 * times. Two things are worth the trouble of a full Express app to check.
 *
 * The identifier pattern. The detail route matched `[0-9]+`, and an ObjectId
 * is hex — so every detail, update and delete route would have answered "not
 * found" for every record that exists. That reads as missing data, not as a
 * broken route, and it would have been blamed on the migration.
 *
 * And the department ceiling, which keeps one wing of the school out of the
 * other's records. It is checked in both directions: that a CBSE
 * administrator sees CBSE records, and that they cannot reach a State one even
 * by asking for it directly.
 */
import express from 'express';
import mongoose from 'mongoose';
import { startMongo } from './mongo-harness.js';

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nVignan ERP — the resource router on MongoDB\n');

const mongo = await startMongo();

const M = await import('../src/db/mongo/models.js');
const { createResourceRouter } = await import('../src/lib/crud.js');
const { errorHandler } = await import('../src/middleware/error.js');

/* --------------------------------------------------------- a small school */
const campus = await M.Campus.create({ code: 'MAIN', name: 'Vignan', status: 'ACTIVE' });
const roleAdmin = await M.Role.create({ code: 'ADMIN', name: 'Admin', level: 100 });
const roleAdmr = await M.Role.create({ code: 'ADMINISTRATOR', name: 'Administrator', level: 80 });
const year = await M.AcademicYear.create({ campus_id: campus._id, name: '2026', start_date: '2026-06-01', end_date: '2027-04-30', is_current: 1, status: 'ACTIVE' });
const dept = await M.Department.create({ campus_id: campus._id, code: 'GEN', name: 'General', status: 'ACTIVE' });

const stateClass = await M.Class.create({ campus_id: campus._id, academic_year_id: year._id, name: 'Class 9 State', board: 'STATE', level: 9, status: 'ACTIVE' });
const cbseClass = await M.Class.create({ campus_id: campus._id, academic_year_id: year._id, name: 'Class 9 CBSE', board: 'CBSE', level: 9, status: 'ACTIVE' });
await M.Section.create({ campus_id: campus._id, class_id: stateClass._id, name: 'A', capacity: 40, status: 'ACTIVE' });
await M.Section.create({ campus_id: campus._id, class_id: stateClass._id, name: 'B', capacity: 40, status: 'ACTIVE' });
await M.Section.create({ campus_id: campus._id, class_id: cbseClass._id, name: 'A', capacity: 40, status: 'ACTIVE' });

const mkUser = async (role, username) => M.User.create({
  campus_id: campus._id, role_id: role._id, username, email: `${username}@v.edu`,
  password_hash: 'x', full_name: username, status: 'ACTIVE',
});
const adminUser = await mkUser(roleAdmin, 'admin');
const cbseUser = await mkUser(roleAdmr, 'cbse');
await M.Administrator.create({
  campus_id: campus._id, user_id: cbseUser._id, department_id: dept._id,
  employee_code: 'ADM1', first_name: 'CBSE Admin', board: 'CBSE', status: 'ACTIVE',
});

/* ------------------------------------------------ an app around the router */
const asUser = (doc, roleCode) => ({
  id: String(doc._id), campus_id: String(campus._id), role_code: roleCode,
  full_name: doc.full_name, username: doc.username,
});

let current = asUser(adminUser, 'ADMIN');
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = current;
  // Every permission, so this exercises the router rather than the permissions.
  req.permissions = { has: () => true };
  next();
});
app.use('/classes', createResourceRouter({
  table: 'classes',
  module: 'academics',
  entityType: 'Class',
  populate: { academic_year_id: { name: 'year_name' } },
  counts: { section_count: { from: 'sections', on: 'class_id' } },
  searchable: ['name'],
  filterable: ['status', 'board'],
  sortable: ['id', 'name', 'level'],
  required: ['name', 'board'],
  board: 'board',
  defaultSort: 'name',
}));
app.use(errorHandler);

const server = app.listen(0);
const port = server.address().port;
const api = (path, opts = {}) => fetch(`http://localhost:${port}${path}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/* ------------------------------------------------------------- listing */
let res = await api('/classes');
check('the list returns records', res.body?.data?.length === 2, `${res.body?.data?.length} class(es)`);
check('records are identified by a string id',
  typeof res.body?.data?.[0]?.id === 'string' && res.body.data[0].id.length === 24);

const state = res.body.data.find((c) => c.board === 'STATE');
check('a populated field is lifted flat, as the join returned it',
  state?.year_name === '2026', `year_name=${state?.year_name}`);
check('a count subquery is answered', state?.section_count === 2, `section_count=${state?.section_count}`);
check('the CBSE class counts its own sections',
  res.body.data.find((c) => c.board === 'CBSE')?.section_count === 1);

/* -------------------------------------------------- the identifier route */
res = await api(`/classes/${state.id}`);
check('the detail route resolves an ObjectId', res.status === 200 && res.body?.data?.id === state.id,
  `status ${res.status} — this is the route that matched [0-9]+ before`);

res = await api('/classes/999');
check('a non-identifier is not treated as one', res.status === 404, `status ${res.status}`);

/* -------------------------------------------------- filtering and search */
res = await api('/classes?board=CBSE');
check('a filter narrows the list', res.body?.data?.length === 1 && res.body.data[0].board === 'CBSE');

res = await api('/classes?search=CBSE');
check('search matches on text', res.body?.data?.length === 1, `${res.body?.data?.length} match(es)`);

res = await api('/classes?search=Class 9 (State');
check('a search containing regex characters does not throw', res.status === 200, `status ${res.status}`);

/* --------------------------------------------------- the writes */
res = await api('/classes', {
  method: 'POST',
  body: JSON.stringify({ academic_year_id: String(year._id), name: 'Class 10 State', board: 'STATE', level: 10, status: 'ACTIVE' }),
});
check('a record can be created', res.status === 201 && res.body?.data?.name === 'Class 10 State', `status ${res.status}`);
const createdId = res.body?.data?.id;
check('a reference given as a string is stored as one',
  res.body?.data?.year_name === '2026', 'and still populates');

res = await api(`/classes/${createdId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Class 10 Renamed' }) });
check('a record can be updated', res.status === 200 && res.body?.data?.name === 'Class 10 Renamed', `status ${res.status}`);

res = await api('/classes', { method: 'POST', body: JSON.stringify({ name: 'No board' }) });
check('a missing required field is refused', res.status === 400, `status ${res.status}`);

res = await api('/classes', {
  method: 'POST',
  body: JSON.stringify({ academic_year_id: 'not-an-id', name: 'Bad ref', board: 'STATE', level: 1, status: 'ACTIVE' }),
});
check('an invalid reference is refused, not stored', res.status === 400, `status ${res.status}`);

/* ------------------------------------------------ THE DEPARTMENT CEILING */
current = asUser(cbseUser, 'ADMINISTRATOR');

res = await api('/classes');
check('an administrator confined to CBSE sees only CBSE',
  res.body?.data?.length === 1 && res.body.data[0].board === 'CBSE',
  `${res.body?.data?.length} class(es)`);

res = await api(`/classes/${state.id}`);
check('and cannot reach a State record by asking for it directly', res.status === 404,
  `status ${res.status} — a deep link must not cross the ceiling`);

res = await api(`/classes/${state.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hijacked' }) });
check('nor update one', res.status === 404, `status ${res.status}`);

res = await api(`/classes/${state.id}`, { method: 'DELETE' });
check('nor delete one', res.status === 404, `status ${res.status}`);

res = await api('/classes', {
  method: 'POST',
  body: JSON.stringify({ academic_year_id: String(year._id), name: 'Sneaky', board: 'STATE', level: 1, status: 'ACTIVE' }),
});
check('nor create one in the other wing', res.status === 403, `status ${res.status}`);

const untouched = await M.Class.findById(state.id).lean();
check('the State record is genuinely unchanged', untouched?.name === 'Class 9 State', untouched?.name);

/* ------------------------------------------------------------- deleting */
current = asUser(adminUser, 'ADMIN');
res = await api(`/classes/${createdId}`, { method: 'DELETE' });
check('an admin can delete', res.status === 200, `status ${res.status}`);
check('and it is gone', (await M.Class.countDocuments({ _id: createdId })) === 0);

/* ------------------------------------------------------------ audit trail */
const logged = await M.ActivityLog.find({ module: 'academics' }).lean();
check('every write was recorded', logged.length >= 3, `${logged.length} entries`);
check('the audit entry points at the record', logged.some((l) => l.entity_id === createdId),
  'an id from any collection, so stored as text');

/* ------------------------------ conditional counts, sums and derived fields */
const vehicle = await M.Vehicle.create({
  campus_id: campus._id, vehicle_number: 'KA-28-1234', vehicle_type: 'BUS',
  capacity: 40, status: 'ACTIVE',
});
const routeDoc = await M.Route.create({
  campus_id: campus._id, route_code: 'R1', name: 'North', vehicle_id: vehicle._id,
  fare: 1200, status: 'ACTIVE',
});
for (const [n, status] of [[1, 'ACTIVE'], [2, 'ACTIVE'], [3, 'INACTIVE']]) {
  const u = await M.User.create({
    campus_id: campus._id, role_id: roleAdmin._id, username: `tp${n}`, email: `tp${n}@v.edu`,
    password_hash: 'x', full_name: `TP${n}`, status: 'ACTIVE',
  });
  const st = await M.Student.create({
    campus_id: campus._id, user_id: u._id, academic_year_id: year._id,
    class_id: stateClass._id, admission_number: `TP${n}`, first_name: `TP${n}`,
    board: 'STATE', status: 'ACTIVE',
  });
  await M.TransportAllocation.create({
    campus_id: campus._id, student_id: st._id, route_id: routeDoc._id,
    vehicle_id: vehicle._id, status, fare: 1200,
  });
}
await M.FuelRecord.create({ campus_id: campus._id, vehicle_id: vehicle._id, fuel_date: '2026-09-01', litres: 50, rate_per_litre: 100, total_cost: 5000 });
await M.FuelRecord.create({ campus_id: campus._id, vehicle_id: vehicle._id, fuel_date: '2026-09-08', litres: 40, rate_per_litre: 100, total_cost: 4000 });

const vehiclesApp = express();
vehiclesApp.use(express.json());
vehiclesApp.use((req, _res, next) => { req.user = current; req.permissions = { has: () => true }; next(); });
vehiclesApp.use('/vehicles', createResourceRouter({
  table: 'vehicles',
  module: 'transport',
  entityType: 'Vehicle',
  counts: {
    route_count: { from: 'routes', on: 'vehicle_id' },
    student_count: { from: 'transport_allocations', on: 'vehicle_id', where: { status: 'ACTIVE' } },
    fuel_cost: { from: 'fuel_records', on: 'vehicle_id', sum: 'total_cost' },
    maintenance_cost: { from: 'vehicle_maintenance', on: 'vehicle_id', sum: 'cost' },
  },
  derive: (row) => ({ spare_seats: Number(row.capacity || 0) - Number(row.student_count || 0) }),
  searchable: ['vehicle_number'],
  sortable: ['id', 'vehicle_number'],
  required: ['vehicle_number'],
  defaultSort: 'vehicle_number',
}));
vehiclesApp.use(errorHandler);
const vServer = vehiclesApp.listen(0);
const vPort = vServer.address().port;
const v = (await (await fetch(`http://localhost:${vPort}/vehicles`)).json()).data[0];

check('a plain count is answered', v.route_count === 1, `route_count=${v.route_count}`);
check('a conditional count excludes what it should',
  v.student_count === 2, `student_count=${v.student_count} (3 allocations, 1 inactive)`);
check('a sum totals the field', v.fuel_cost === 9000, `fuel_cost=${v.fuel_cost}`);
check('a sum with no rows is zero, not missing',
  v.maintenance_cost === 0, `maintenance_cost=${v.maintenance_cost}`);
check('a derived field is computed from the row',
  v.spare_seats === 38, `spare_seats=${v.spare_seats}`);

vServer.close();
server.close();
await mongo.stop();

const failed = results.filter((x) => !x).length;
console.log(`\n  ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
