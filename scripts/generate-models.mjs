import fs from 'node:fs';
const plan = JSON.parse(fs.readFileSync('d:/erp/scripts/model-plan.json', 'utf8'));

const field = (f) => {
  const parts = [];
  parts.push(f.type === 'ObjectId' ? `type: Types.ObjectId, ref: '${f.ref}'` : `type: ${f.type}`);
  if (f.required) parts.push('required: true');
  if (f.unique) parts.push('unique: true');
  if (f.enum) parts.push(`enum: [${f.enum.map((v) => `'${v}'`).join(', ')}]`);
  if (f.default !== undefined) parts.push(`default: ${typeof f.default === 'string' ? `'${f.default}'` : f.default}`);
  if (f.ref) parts.push('index: true');
  return `    ${f.col}: { ${parts.join(', ')} },`;
};

const head = `/**
 * The document model.
 *
 * Generated from server/src/db/schema.pg.sql — sixty-six collections, two
 * hundred references and sixty-five enumerations, carried across exactly as the
 * relational schema stated them rather than retyped from memory.
 *
 * One thing does not survive the crossing. A foreign key is a promise the
 * database keeps: PostgreSQL will not record a mark against a pupil who is not
 * there. \`ref\` makes no such promise — it only tells populate() where to look,
 * and MongoDB will happily store a reference to nothing. Every one of those two
 * hundred promises is now the application's to keep, which is what
 * db/mongo/integrity.js is for.
 *
 * Regenerate with: node scripts/generate-models.mjs
 */
import mongoose from 'mongoose';

const { Schema, Types } = mongoose;

/** Every collection carries created_at/updated_at, as the tables did. */
const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
};

export const models = {};
const define = (name, collection, definition, indexes = []) => {
  const schema = new Schema(definition, { ...options, collection });
  for (const ix of indexes) schema.index(...ix);
  models[name] = mongoose.models[name] || mongoose.model(name, schema);
  return models[name];
};

`;

const body = plan.map((t) => {
  const fields = t.fields.map(field).join('\n');
  return `/* ${t.table} */
export const ${t.model} = define('${t.model}', '${t.table}', {
${fields}
});`;
}).join('\n\n');

const tail = `

/** Every model by its collection name, for the generic data layer. */
export const byCollection = Object.fromEntries(
  Object.values(models).map((m) => [m.collection.collectionName, m])
);

export default models;
`;

fs.writeFileSync('d:/erp/server/src/db/mongo/models.js', head + body + tail);
console.log('models.js written:', plan.length, 'models');
