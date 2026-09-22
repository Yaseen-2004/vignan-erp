/**
 * The MongoDB connection, and the few things every collection needs.
 *
 * The relational layer this replaces offered get/all/run over SQL. Nothing of
 * that shape survives translation honestly — a JOIN is not a populate and
 * pretending otherwise hides the places where they differ — so routes talk to
 * models directly and this module handles what is common to all of them.
 *
 * The one contract kept exactly is the shape seen from outside. Records are
 * identified by `id`, a string, as they always were; that `id` is now an
 * ObjectId rather than a counter is the database's business and nobody else's.
 * Keeping it means the portal, the tests and every stored link go on working.
 */
import mongoose from 'mongoose';
import env from '../../config/env.js';

mongoose.set('strictQuery', true);

/**
 * `_id` is presented as `id`, and every reference as a plain string.
 *
 * Applied globally rather than per model: a collection that forgot it would
 * send `_id` to a portal expecting `id`, and the failure would look like
 * missing data rather than a missing setting.
 */
mongoose.plugin((schema) => {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      for (const [k, v] of Object.entries(ret)) {
        if (v instanceof mongoose.Types.ObjectId) ret[k] = String(v);
      }
      return ret;
    },
  });
  schema.set('toObject', { virtuals: true });
});

let connected = false;

export async function connect() {
  if (connected) return mongoose.connection;
  if (!env.mongoUrl) {
    throw new Error(
      'MONGODB_URI is not set. The API keeps every record there, so it cannot '
      + 'start without one. MongoDB Atlas has a free tier; see .env.example.'
    );
  }

  await mongoose.connect(env.mongoUrl, {
    dbName: env.mongoDbName || undefined,
    // A deployed instance may be one of many, each holding its own pool; a
    // large pool per instance is how a managed cluster runs out of connections.
    maxPoolSize: env.mongoPoolMax,
    serverSelectionTimeoutMS: 15_000,
  });
  connected = true;

  mongoose.connection.on('error', (error) => console.error('· database error:', error.message));
  return mongoose.connection;
}

export async function close() {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

export const describe = () => {
  if (!connected) return 'not connected';
  const { host, name } = mongoose.connection;
  return `MongoDB (${host}/${name})`;
};

export const isConnected = () => connected;

/* ===================================================================== */
/*  IDENTIFIERS                                                          */
/* ===================================================================== */

/**
 * Turn whatever arrived into an ObjectId, or null.
 *
 * Route parameters are strings from the outside world. Handing an invalid one
 * straight to a query throws a CastError, which reaches the person as "something
 * went wrong" for what is really "no such record". Returning null lets the
 * caller answer 404, which is the truth.
 */
export function oid(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.isValidObjectId(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
}

/** The same, for a list — dropping anything that is not an identifier. */
export const oids = (values) => (Array.isArray(values) ? values.map(oid).filter(Boolean) : []);

/* ===================================================================== */
/*  TRANSACTIONS                                                         */
/* ===================================================================== */

/**
 * Run a unit of work that must not land half-finished — collecting a fee
 * writes a payment, adjusts a balance and issues a receipt, and two of those
 * three is a dispute with a parent.
 *
 * MongoDB transactions require a replica set. Atlas is one; a single mongod
 * started for a test is not. Rather than fail there, this runs the work without
 * a session and says so once, because a test that cannot run is worse than one
 * that runs without the guarantee it is not testing.
 */
let warnedAboutTransactions = false;

export async function transaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (error) {
    if (/Transaction numbers are only allowed|not supported|replica set/i.test(error?.message || '')) {
      if (!warnedAboutTransactions) {
        console.warn('· this MongoDB is not a replica set, so writes are not atomic');
        warnedAboutTransactions = true;
      }
      return work(null);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export default mongoose;
