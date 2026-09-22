/**
 * The document model, against a real MongoDB.
 *
 * Runs a genuine mongod rather than a stub, because what is being checked is
 * whether the constraints carried over from the relational schema still bite:
 * an enumeration, a required field, a unique index. A stub would agree with
 * whatever the models claimed.
 *
 * The last check is the important one. It asserts a *failure* — that MongoDB
 * accepts a reference to a document that does not exist, which PostgreSQL
 * refused two hundred times over. It is here so the gap is visible and stays
 * visible until the data layer closes it.
 */
import mongoose from 'mongoose';
import { startMongo } from './mongo-harness.js';

const results = [];
const check = (label, ok, detail = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };

const mongo = await startMongo();
check('mongod is running and mongoose connected', mongoose.connection.readyState === 1, mongo.uri);

const { Campus, Role, User, Permission } = await import('../src/db/mongo/models.js');
check('the generated models load', !!User && !!Role);

const campus = await Campus.create({ code: 'MAIN', name: 'Vignan Educational Institutions', status: 'ACTIVE' });
const role = await Role.create({ code: 'ADMIN', name: 'Administrator', level: 100 });
check('a campus and a role save', !!campus._id && !!role._id);

const user = await User.create({
  campus_id: campus._id, role_id: role._id, username: 'admin',
  email: 'office@vignan.edu.in', password_hash: 'x', full_name: 'Administrator',
});
check('a user saves with its references', String(user.role_id) === String(role._id));

// The constraints carried over from the relational schema must actually bite.
let rejected = false;
try { await User.create({ campus_id: campus._id, role_id: role._id, username: 'b', email: 'b@x', password_hash: 'x', full_name: 'B', gender: 'YES' }); }
catch { rejected = true; }
check('an invalid enumeration is refused', rejected, 'gender: YES');

rejected = false;
try { await User.create({ campus_id: campus._id, role_id: role._id, username: 'c', email: 'c@x', password_hash: 'x' }); }
catch { rejected = true; }
check('a missing required field is refused', rejected, 'no full_name');

await User.init();               // indexes must be built for unique to apply
rejected = false;
try { await User.create({ campus_id: campus._id, role_id: role._id, username: 'admin', email: 'd@x', password_hash: 'x', full_name: 'D' }); }
catch { rejected = true; }
check('a duplicate username is refused', rejected, 'username: admin twice');

const loaded = await User.findOne({ username: 'admin' }).populate('role_id').populate('campus_id');
check('populate follows a reference', loaded?.role_id?.code === 'ADMIN' && loaded?.campus_id?.name?.startsWith('Vignan'),
  `${loaded?.role_id?.code} at ${loaded?.campus_id?.name}`);

// The gap MongoDB leaves, now closed in the schema rather than in each route.
let refused = false;
try {
  await User.create({
    campus_id: campus._id, role_id: new mongoose.Types.ObjectId(),   // no such role
    username: 'orphan', email: 'o@x', password_hash: 'x', full_name: 'Orphan',
  });
} catch (e) { refused = /does not exist/.test(e.message); }
check('a reference to a missing document is refused', refused,
  'what the 200 foreign keys used to guarantee');

// And a deletion that would strand records can be seen before it happens.
const { dependentsOf } = await import('../src/db/mongo/integrity.js');
const blocking = await dependentsOf('Role', role._id);
check('what a deletion would strand can be reported', blocking.some((b) => b.collection === 'users'),
  blocking.map((b) => `${b.count} ${b.collection}.${b.field}`).join(', '));

// An identifier is presented as `id`, a string, exactly as the API always did.
const shown = loaded.toJSON();
check('records are still identified by a string `id`',
  typeof shown.id === 'string' && shown._id === undefined, shown.id);

await mongo.stop();
const failed = results.filter((x) => !x).length;
console.log(`\n  ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
