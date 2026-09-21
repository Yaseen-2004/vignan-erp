/**
 * Links to a child's files must expire, and must not be forgeable.
 *
 * Run against the API with a file uploaded through it, because the thing being
 * checked is the whole path: the link the API hands out, and what the server
 * does with a link that has been tampered with.
 */
const API = 'http://localhost:4000/api';
const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nVignan ERP — signed file links\n');

const login = await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: 'admin', password: 'Vignan@123', portal: 'ADMIN' }),
})).json();
const auth = { Authorization: `Bearer ${login.data.accessToken}` };

// Put a real file in, so there is something to ask for.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const student = (await (await fetch(`${API}/students?limit=1`, { headers: auth })).json()).data[0];
const form = new FormData();
form.append('photo', new Blob([png], { type: 'image/png' }), 'portrait.png');
const uploaded = await (await fetch(`${API}/students/${student.id}/photo`, { method: 'POST', headers: auth, body: form })).json();

const link = uploaded.data?.photo;
check('the API hands back a signed link', /^\/uploads\/photos\/[^?]+\?e=\d+&s=[\w-]{27}$/.test(link || ''), link);

const [path] = (link || '').split('?');
const params = new URLSearchParams((link || '').split('?')[1] || '');

check('the signed link opens the file',
  (await fetch(`http://localhost:4000${link}`)).status === 200);

check('without a signature it is refused',
  (await fetch(`http://localhost:4000${path}`)).status === 403, 'the old behaviour, now closed');

check('with a wrong signature it is refused',
  (await fetch(`http://localhost:4000${path}?e=${params.get('e')}&s=${'A'.repeat(27)}`)).status === 403);

check('with the expiry pushed out it is refused',
  (await fetch(`http://localhost:4000${path}?e=${Number(params.get('e')) + 86400}&s=${params.get('s')}`)).status === 403,
  'the signature covers the expiry, so it cannot be extended');

check('an already-expired link is refused',
  (await fetch(`http://localhost:4000${path}?e=1&s=${params.get('s')}`)).status === 403);

// A signature for one file must not open another.
const other = '/uploads/photos/someone-elses.png';
check("one file's signature does not open another",
  (await fetch(`http://localhost:4000${other}?e=${params.get('e')}&s=${params.get('s')}`)).status === 403);

// Links inside a list must be signed too — that is what the central walk is for.
const list = await (await fetch(`${API}/students?limit=50`, { headers: auth })).json();
const photos = (list.data || []).map((s) => s.photo).filter(Boolean);
check('links nested in a list are signed too',
  photos.length === 0 || photos.every((p) => p.includes('&s=')),
  `${photos.length} photo(s) in the list`);

// Tidy up.
await fetch(`${API}/students/${student.id}`, {
  method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ photo: null }),
});

const failed = results.filter((x) => !x).length;
console.log(`\n  ${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
