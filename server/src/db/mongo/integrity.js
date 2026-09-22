/**
 * The promises the database used to keep.
 *
 * PostgreSQL held two hundred foreign keys. Each was a promise: a mark cannot
 * be recorded against a pupil who does not exist, a fee cannot be collected for
 * a class that was deleted, and a deletion that would strand records is refused
 * rather than performed. Those promises were kept by the database on every
 * write, including the ones nobody remembered to check.
 *
 * MongoDB makes none of them. `ref` tells populate where to look; it does not
 * say the document is there. A reference to nothing saves cleanly and reads
 * back as null, which surfaces months later as a mark belonging to no pupil.
 *
 * So the promises are kept here instead, and — this is the point — kept by the
 * schema rather than by each route remembering. Every model gets the checks its
 * references imply, derived from the same source the models were.
 */
import mongoose from 'mongoose';

/**
 * Before saving, every reference on the document must point at something.
 *
 * Applied as schema middleware, so it holds for a route that was written
 * carefully and for one written in a hurry alike.
 */
export function enforceReferences(schema, modelName) {
  const refs = [];
  schema.eachPath((path, type) => {
    const ref = type?.options?.ref || type?.caster?.options?.ref;
    if (ref) refs.push({ path, ref, many: type instanceof mongoose.Schema.Types.Array });
  });
  if (!refs.length) return;

  schema.pre('save', async function checkReferences() {
    for (const { path, ref, many } of refs) {
      const value = this.get(path);
      if (value == null) continue;                       // optional, and absent
      const ids = many ? value : [value];
      if (!ids.length) continue;

      const Target = mongoose.model(ref);
      const found = await Target.countDocuments({ _id: { $in: ids } });
      if (found !== ids.length) {
        /*
         * A plain error carrying the reason. Wrapping it in mongoose's
         * ValidationError replaced the message with "Validation failed",
         * which tells whoever reads it nothing at all — the whole point is
         * to say which reference points at nothing.
         */
        throw Object.assign(
          new Error(`${path} refers to a ${ref.toLowerCase()} that does not exist`),
          { name: 'ReferenceError', code: 'MISSING_REFERENCE', model: modelName, path, ref }
        );
      }
    }
  });
}

/**
 * What a deletion would strand.
 *
 * `ON DELETE RESTRICT` refused to remove a class while pupils were in it, which
 * is the behaviour a school wants: the records are the point, and a deletion
 * that quietly orphans them is worse than one that fails. This reports what
 * points at a document so the route can refuse with something a person can act
 * on — "34 pupils are in this class" rather than "constraint violation".
 */
export async function dependentsOf(modelName, id) {
  const found = [];
  for (const Model of Object.values(mongoose.models)) {
    Model.schema.eachPath((path, type) => {
      const ref = type?.options?.ref || type?.caster?.options?.ref;
      if (ref === modelName) found.push({ Model, path });
    });
  }

  const blocking = [];
  for (const { Model, path } of found) {
    const count = await Model.countDocuments({ [path]: id });
    if (count) blocking.push({ collection: Model.collection.collectionName, field: path, count });
  }
  return blocking;
}

/**
 * Apply the reference checks to every model.
 *
 * Called once at startup, after the models are defined — which is why it is a
 * function rather than something models.js does for itself: the checks look up
 * other models by name, and they all have to exist first.
 */
export function enforceAll(models) {
  for (const [name, Model] of Object.entries(models)) {
    enforceReferences(Model.schema, name);
  }
}
