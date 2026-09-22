/**
 * Derive the Mongoose models from the PostgreSQL schema.
 *
 * Sixty-six tables, two hundred foreign keys and every CHECK constraint are
 * already written down precisely. Transcribing them by hand would introduce
 * differences nobody intended — a nullable column silently made required, an
 * enumeration missing a value — and each one becomes a bug months later. So
 * they are read from the schema itself.
 *
 * What the translation keeps:
 *   NOT NULL          -> required
 *   UNIQUE            -> unique index
 *   CHECK (x IN ...)  -> enum
 *   DEFAULT           -> default
 *   REFERENCES t(id)  -> ObjectId ref, so populate() can follow it
 *
 * What it cannot keep is the foreign key itself. PostgreSQL refuses to record
 * a mark against a pupil who does not exist; MongoDB will accept it. `ref` only
 * tells populate where to look. That gap is made up in the data layer.
 */
import fs from 'node:fs';

const sql = fs.readFileSync('d:/erp/server/src/db/schema.pg.sql', 'utf8');

const TYPES = {
  SERIAL: 'Number', INTEGER: 'Number', BIGINT: 'Number', NUMERIC: 'Number',
  REAL: 'Number', 'DOUBLE PRECISION': 'Number', TEXT: 'String', BOOLEAN: 'Boolean',
};

/*
 * The singular of a table name.
 *
 * `-ses` has no rule that works: `campuses` comes from `campus` and loses
 * `es`, while `courses` comes from `course` and loses only the `s`. English
 * does not say which from the plural alone, and guessing produced a model
 * called `Cours` that failed to import — obvious once it broke, invisible
 * until then. There are five such tables in this schema, so they are named.
 */
const IRREGULAR = {
  campuses: 'campus',
  classes: 'class',
  courses: 'course',
  expenses: 'expense',
  purchases: 'purchase',
};

const singular = (t) => {
  if (IRREGULAR[t]) return IRREGULAR[t];
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.endsWith('xes') || t.endsWith('ches') || t.endsWith('shes')) return t.slice(0, -2);
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
};

const pascal = (t) => singular(t).split('_').map((p) => p[0].toUpperCase() + p.slice(1)).join('');

const tables = [];
const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g;
let m;
while ((m = re.exec(sql))) {
  const [, name, bodyRaw] = m;
  const body = bodyRaw.split('\n').map((l) => l.trim()).filter(Boolean);
  const fields = [];
  const tableLevel = [];

  for (let line of body) {
    line = line.replace(/,$/, '');
    if (/^(PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|CONSTRAINT)/i.test(line)) { tableLevel.push(line); continue; }
    const fm = line.match(/^(\w+)\s+(SERIAL|INTEGER|BIGINT|NUMERIC(?:\([\d,\s]+\))?|REAL|DOUBLE PRECISION|TEXT|BOOLEAN)\b(.*)$/i);
    if (!fm) continue;
    const [, col, rawType, rest] = fm;
    if (col === 'id') continue;                       // Mongo supplies _id

    const type = TYPES[rawType.toUpperCase().replace(/\(.*\)/, '')] || 'String';
    const f = { col, type };
    if (/\bNOT NULL\b/i.test(rest)) f.required = true;
    if (/\bUNIQUE\b/i.test(rest)) f.unique = true;

    const ref = rest.match(/REFERENCES\s+(\w+)\s*\(\s*id\s*\)/i);
    if (ref) { f.ref = pascal(ref[1]); f.type = 'ObjectId'; }

    const chk = rest.match(/CHECK\s*\(\s*\w+\s+IN\s*\(([^)]+)\)/i);
    if (chk) f.enum = chk[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));

    const def = rest.match(/DEFAULT\s+('(?:[^']*)'|\d+(?:\.\d+)?)/i);
    if (def && !/to_char|now\(\)/i.test(rest)) {
      f.default = def[1].startsWith("'") ? def[1].slice(1, -1) : Number(def[1]);
    }
    if (/created_at|updated_at/.test(col)) continue;   // timestamps: true covers these
    fields.push(f);
  }
  tables.push({ table: name, model: pascal(name), fields, tableLevel });
}

console.log(`${tables.length} tables`);
console.log(`${tables.reduce((n, t) => n + t.fields.filter((f) => f.ref).length, 0)} references`);
console.log(`${tables.reduce((n, t) => n + t.fields.filter((f) => f.enum).length, 0)} enumerations`);
fs.writeFileSync('d:/erp/scripts/model-plan.json', JSON.stringify(tables, null, 1));
console.log('\nplan written');
