/**
 * Build the indexes the models declare.
 *
 * Mongoose builds them in the background on first use, which is fine on a
 * laptop and wrong on a deployment: a unique index that has not finished
 * building does not prevent a duplicate, so two pupils can be enrolled with one
 * admission number in the window nobody is watching. This builds them on
 * purpose, before anyone is using it, and says what it built.
 *
 *   npm run mongo:indexes -w server
 */
import { connect, close, describe } from './connection.js';
import models from './models.js';

await connect();
console.log(`\n  ${describe()}\n`);

let total = 0;
for (const [name, Model] of Object.entries(models)) {
  await Model.createIndexes();
  const indexes = await Model.collection.indexes();
  const extra = indexes.filter((i) => i.name !== '_id_');
  total += extra.length;
  if (extra.length) {
    console.log(`  ${Model.collection.collectionName.padEnd(26)} ${extra.map((i) => i.name + (i.unique ? ' (unique)' : '')).join(', ')}`);
  }
}

console.log(`\n  ${total} indexes across ${Object.keys(models).length} collections\n`);
await close();
