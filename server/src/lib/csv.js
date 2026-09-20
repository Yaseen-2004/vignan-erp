/**
 * Reading and writing CSV.
 *
 * Splitting on commas is not parsing CSV: an address with a comma in it, a
 * remark containing a quotation mark, a value spanning two lines — all of them
 * are ordinary in a spreadsheet exported by a school office, and all of them
 * break a naive split. This follows RFC 4180, and additionally tolerates what
 * Excel actually produces: a UTF-8 byte-order mark, CRLF endings, and a
 * trailing newline.
 *
 * Rows come back keyed by header, with the line number each came from so an
 * error can name the row the person is looking at in their spreadsheet.
 */

/** Split CSV text into rows of raw string fields. */
export function parseRows(text) {
  const input = text.replace(/^﻿/, ''); // Excel writes a byte-order mark
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false; // distinguishes an empty final line from a real row

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];

    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; }  // "" is an escaped quote
        else quoted = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"' && field === '') { quoted = true; started = true; continue; }
    if (c === ',') { row.push(field); field = ''; started = true; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      if (started || row.length > 1 || row[0] !== '') rows.push(row);
      row = []; field = ''; started = false;
      continue;
    }
    field += c;
    started = true;
  }

  if (started || field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse into objects keyed by column heading.
 *
 * Headings are matched loosely — case, spaces and punctuation are ignored — so
 * "Date of Birth", "date_of_birth" and "DATE OF BIRTH" all reach the same
 * field. A person filling in a template should not have to match it exactly.
 */
export function parseCsv(text) {
  const rows = parseRows(text);
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.trim());
  const keys = headers.map(normaliseHeader);

  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    // A row of nothing but empty cells is a blank line, not a record.
    if (cells.every((c) => c.trim() === '')) continue;
    const record = {};
    for (let c = 0; c < keys.length; c += 1) {
      record[keys[c]] = (cells[c] ?? '').trim();
    }
    out.push({ line: i + 1, values: record });
  }
  return { headers, keys, rows: out };
}

/** "Date of Birth" and "date_of_birth" are the same column. */
export const normaliseHeader = (header) =>
  String(header).trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');

/** One CSV field, quoted only when it has to be. */
function quote(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build CSV text from a header list and rows of values. */
export function toCsv(headers, rows) {
  const lines = [headers.map(quote).join(',')];
  for (const row of rows) lines.push(headers.map((h) => quote(row[h])).join(','));
  // A byte-order mark keeps Excel from mangling non-ASCII names.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
