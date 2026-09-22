# Vignan Educational Institutions — School ERP Portal

A complete, database-driven school ERP with four separate top-level sections, six roles,
permission-based authorisation enforced at the API, and a public website fed by the built-in CMS.

Configured for **Vignan Vidyalayam, Raichur, Karnataka**, which runs two departments side by
side — the **Karnataka State Board** and **CBSE**. Every class, section, course, student and
staff member belongs to a department, and Admin and Administrator both have complete access
across the two.

```
ADMIN                    controls the SOFTWARE
  └── ADMINISTRATOR      manages STUDENTS & FACULTY
        └── FACULTY      Financial Staff  ·  Teaching Staff

STUDENTS & PARENTS       Student portal   ·  Parent portal
```

---

## The two departments

The school teaches the same class levels under two examination boards. The distinction lives on
`classes.board` and is carried onto `students.board` (kept in step whenever a student's class
changes) and `faculty.board` (`STATE`, `CBSE`, or `BOTH` for staff who cover the whole school).

* "Class 8" exists once in each department — the unique key on `classes` includes the board.
* Class and section pickers are labelled `Class 8 · State` / `Class 8 · CBSE` so the two wings
  are never confused.
* Every relevant list has a **Department** filter; the Admin and Administrator dashboards show a
  head-count split.
* Fee structures differ by department, and the CBSE wing carries a higher tuition in the seed.
* The subject departments (Science, Mathematics, ...) are a separate concept and are labelled
  **Subject Departments** in the UI so the two never collide.

### The Departments section

**Departments** in the sidebar (Admin and Administrator) shows the two wings side by side with
live head-counts, class ladders, attendance and fee collection. Choosing one sets the working
department for the session and drops you into that wing's students; the operations listed on the
page — admission, enrolment, classes, sections, courses, assignments, faculty, attendance,
examinations, results, fees — then act inside it.

**Admission** begins with the department: the form will not submit without it, and the class and
section pickers only offer that wing, so a student cannot be enrolled into the wrong one. The
enrolment row records the department, and both the student and faculty profiles state it in the
header.

### Choosing a department

Admin and Administrator both have complete access to both wings, so the department is a
**working scope** rather than a restriction. A selector in the topbar offers *All departments*,
*State Board* and *CBSE*; the choice is remembered per browser and:

* narrows every scoped list — students, classes, sections, courses, course assignments, faculty;
* narrows the Admin and Administrator dashboards;
* limits class, section and course pickers to that wing, so the two never get mixed up;
* pre-fills the department on a new record.

No other role sees the selector. Teachers are scoped by **course assignment** — the rows in
`course_assignments` decide which courses, sections, students, attendance registers and mark
sheets they can reach, regardless of which wing they belong to. A teacher who covers both wings
(Physical Education, in the seed) is recorded as `BOTH`, and filtering staff by a department also
returns the `BOTH` members who serve it.

Upgrading an existing database is handled by `npm run db:migrate`, which adds the columns in
place and rebuilds `classes` so its uniqueness includes the board.

---

## Quick start

```bash
npm install          # installs both workspaces
npm run setup        # creates the database, applies the schema, seeds demo data
npm run dev          # API on :4000, Vite dev server on :5173
```

Open <http://localhost:5173> and sign in. Every demo account uses the password **`Vignan@123`**.

| Role | Username | Lands on |
|---|---|---|
| Admin | `admin` | `/admin/dashboard` |
| Administrator | `shobha` | `/administrator/dashboard` |
| Administrator *(deliberately restricted)* | `mallikarjun` | `/administrator/dashboard` |
| Teaching Staff | `basavaraj` | `/faculty/teaching/dashboard` |
| Teaching Staff *(different assignments)* | `sunanda` | `/faculty/teaching/dashboard` |
| Financial Staff | `gurunath` | `/faculty/financial/dashboard` |
| Student | `vgn20250001` | `/student/dashboard` |
| Parent *(two children)* | `pvgn20250248` | `/parent/dashboard` |

The public website — driven entirely by published CMS content — is at **`/site`** and needs no login.

### Production

```bash
npm run build        # builds the SPA into web/dist
npm start            # Express serves the API and the built SPA on one port
```

In production the server refuses to boot without real secrets in `server/.env`
(copy `.env.example` and set `JWT_SECRET` / `JWT_REFRESH_SECRET`).

---

## Tests

```bash
npm test             # UI render suite, then the API suite (server must be running for the API suite)
npm run test:ui      # 146 server-side renders across every page and role
npm run test:api     # 137 API, RBAC and workflow assertions
```

The API suite asserts the security rules by name — Student A cannot read Student B, Parent A
cannot read Parent B's child, Teacher A cannot write Teacher B's marks, Financial Staff cannot
touch examination results, and an Administrator cannot change system settings.

---

## Architecture

```
erp/
├── server/                     Express + PostgreSQL (cloud, or PGlite locally)
│   ├── src/
│   │   ├── db/                 schema.sql (65 tables), migrate.js, seed.js
│   │   ├── lib/                permissions catalogue, RBAC scope helpers, CRUD factory, audit
│   │   ├── middleware/         auth, validation, uploads, rate limiting, error handling
│   │   └── routes/             one module per ERP area
│   └── tests/api.test.js
└── web/                        React 18 + Vite
    ├── src/
    │   ├── components/         design system, DataTable, ResourcePage, PermissionMatrix
    │   ├── pages/              dashboards, people, academics, finance, portal, shared
    │   ├── modules.jsx         declarative config for every standard CRUD screen
    │   └── nav.js              the four sections' navigation, exactly as specified
    └── tests/smoke.mjs
```

### Database

**PostgreSQL, reached two ways.** Set `DATABASE_URL` and every record — pupils, marks, fees,
the audit trail — is stored in the school's managed cloud database. Leave it unset and the
server runs on PGlite, which is PostgreSQL itself compiled to WebAssembly, stored under
`server/data/pg` with nothing to install.

Both are the same engine, so there is one SQL dialect in the codebase and no branch anywhere
outside `connection.js`. Development and the test suites run against real PostgreSQL without
needing a server; production runs against the cloud with the same statements.

65 tables covering identity, academics, attendance, examinations, fees, payroll, transport,
library, inventory, communication and system settings, with foreign keys, `CHECK` constraints
and indexes.

#### Putting the data in the cloud

Any managed PostgreSQL works — the connection string is the only thing that changes.

```bash
# 1. Point at the school's database (server/.env)
DATABASE_URL=postgresql://user:pass@host/vignan?sslmode=require

# 2. Create the schema there
npm run migrate -w server

# 3. Either load the existing records from the old SQLite file...
npm run db:import -w server -- --file ./server/data/vignan_erp.db

#    ...or start fresh with the demo dataset
npm run seed -w server
```

`db:import` works the table order out from the foreign keys, empties each target table before
loading so it can be repeated after a failure, and moves the id sequences past the imported
rows. Run it with `--dry` first to see what it would carry across.

The schema is generated: edit `server/src/db/schema.sql` and run `npm run db:pgschema -w server`
to regenerate `schema.pg.sql`. `npm run test:schema -w server` applies it to a real PostgreSQL
and checks the result, so the translation is verified without a cloud database to hand.

Every institutional table carries `campus_id`, so additional Vignan campuses can be onboarded
without redesigning anything. The seed ships two campuses and three academic years.

## Going live

    npm run secrets -w server        generate the token secrets
    npm run push:keys -w server      generate the notification keys
    npm run setup:production -w server   schema, one campus, one administrator
    npm run preflight -w server      what is not ready yet

`preflight` reports the failures that do not announce themselves — a database
that will be discarded at the next deploy, uploaded files going to a disk that
is wiped, a placeholder left in a secret, demo pupils still present. It changes
nothing; it reads and reports.

### Links to a child's files

Photographs and documents are served through links that expire. The names have
always been unguessable, which is not the same as private: a URL travels in
browser history, in a screenshot, in a forwarded message, and one that worked
for ever would keep working wherever it ended up. Every link the API hands out
now carries an expiry and a signature over it, so a leaked link stops working
and an altered one is refused.

## Deploying

The portal and the API are deployed separately, because they need different
things. The portal is static files and belongs on a CDN; the API is a Node
server that writes uploaded files to disk and holds connections to PostgreSQL,
and belongs on a host that provides both.

### The arrangement these files describe

The API on Render, the portal on Vercel. They are separate services on separate
hosts, which is why three settings exist that a combined deployment does not
need: `VITE_API_URL` tells the portal where the API is, `CORS_ORIGINS` tells the
API which site may call it, and `COOKIE_SAMESITE=none` lets the session cookie
travel between them. Miss the last one and signing in appears to work, then
forgets itself on the next page load.

`.vercelignore` keeps Vercel from deploying the API as well. Vercel treats any
file under `api/` as a function whether or not `vercel.json` mentions it, and
two APIs answering the same portal — one of them with no database — is worse
than either alone.

### Both halves on Vercel, instead

Import the repository and Vercel reads `vercel.json`: it builds the web
workspace, publishes `web/dist`, and runs the Express API as a function under
`api/`. Because both are served from one origin, `VITE_API_URL`,
`CORS_ORIGINS` and `COOKIE_SAMESITE` are all unnecessary — they exist for
hosting the two apart.

Set in the project's environment:

    DATABASE_URL       a managed PostgreSQL connection string — required, as
                       there is no disk here to keep a local database on. Use
                       the provider's *pooled* string: a serverless deployment
                       may run many instances, each holding connections.
    JWT_SECRET         generated, see .env.example
    JWT_REFRESH_SECRET generated, a different one
    S3_BUCKET etc.     required for uploads, which otherwise go to a filesystem
                       that is discarded when the function finishes
    VAPID_*            from `npm run push:keys -w server`, for notifications

The API refuses to start without `DATABASE_URL` rather than appearing to work
while every enrolment is written to a disk about to be thrown away.

Vercel looks for a directory named `public` unless told otherwise, which is
why the output directory is named explicitly — a build that succeeds and then
reports "No Output Directory named public" has found this file missing.

`/api` and `/uploads` are deliberately left out of the single-page rewrite.
They belong to the API, and answering them with the portal's HTML would turn a
clear failure into a baffling one: the portal would receive a web page where it
expected data.

### The portal — Cloudflare

Alternatively, point Cloudflare at this repository with:

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Build command | `npm run build -w web` |
| Build output | `web/dist` |
| Deploy command | `npx wrangler deploy` |

`web/wrangler.jsonc` does the rest. The root directory matters: this is an npm
workspace, and Wrangler run at the top cannot tell which of `server` and `web`
it is meant to deploy — that is what "application detection logic has been run
in the root of a workspace" means.

Set one build variable: `VITE_API_URL`, the address of the API, without a
trailing slash. Leave it unset only when the API is served from the same origin.

### The API — Render

`server/` carries its own manifest and lockfile, so it installs and runs
without the rest of the repository. `render.yaml` describes the service; import
it as a Blueprint, or create a Web Service by hand with:

| Setting | Value |
| --- | --- |
| Root directory | `server` |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check | `/api/health` |

Then, in the dashboard, the values `render.yaml` deliberately leaves out — they
do not belong in a public file. `npm run secrets -w server` generates the token
secrets; `npm run preflight -w server` says what is still missing.

Set `DATABASE_URL` before the first deploy. Without it the server refuses to
start rather than keeping the school's records on a disk that the next release
replaces — which is what it used to do, silently, on any host it had not been
told about.

The free plan sleeps after inactivity and takes around thirty seconds to wake.
That is usually acceptable for a school; a paid plan removes it.

### The API — any other Node host

Render, Railway and Fly.io all work and all have a free tier; so does a plain
VPS. Start command `npm start`, and set in the environment:

    DATABASE_URL       the PostgreSQL connection string
    JWT_SECRET         generated, see .env.example
    JWT_REFRESH_SECRET generated, a different one
    CORS_ORIGINS       the portal's address, e.g. https://vignan-erp.pages.dev
    COOKIE_SAMESITE    none
    VAPID_*            from `npm run push:keys -w server`, for notifications

`COOKIE_SAMESITE=none` is the one easily missed. With the portal on another
host every request between them is cross-site, and a `lax` cookie is not sent
cross-site — so signing in appears to work and the session is gone on the next
page load. It requires https, which both hosts provide.

### Uploaded files

Photographs, documents and course materials go to object storage when it is
configured, and to a folder beside the server when it is not.

The distinction matters on a host. Most give a container a fresh filesystem on
every deploy, so files written beside the server disappear at the next release —
the records survive, since they are in PostgreSQL, but the files they point at do
not, and nobody notices until a parent opens a blank document.

Any S3-compatible service works; Cloudflare R2 has a free tier and no egress
charges. Set `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` (see `.env.example`) and that is the whole change: files
are addressed by the same paths either way, so nothing else differs. Leave them
unset for development.

`/api/health` reports which store is in use, along with the database.

### Device notifications



Notifications reach the phone or desktop, not only the bell in the corner. A parent
is told their child was marked absent while the portal is closed; a teacher hears a
marks sheet came back without keeping a tab open.

Standard web push. `server/src/lib/push.js` sends, `web/public/sw.js` receives and
displays — the service worker runs whether or not the portal is open, which is the
whole point. Everything already routed through `notify()` goes out this way too, so
no feature had to be taught about it separately.

The push is a courtesy on top of the record, never a replacement: the notification row
is written first and the push is not awaited, so a slow push service cannot hold up the
marks approval that caused it, and a device that never receives it still finds the
notification waiting in the portal.

Switching it on is per browser and per person, from **Notifications** in any portal.
Subscriptions rot on their own — a browser reinstalled, permission withdrawn — and are
deleted the moment the push service reports 404 or 410.

Setup is one command and no account with anybody:

    npm run push:keys -w server     # writes a VAPID pair to paste into server/.env

Leave the keys unset and push is simply off; the bell is unaffected. Push needs HTTPS in
production (localhost is exempt). On iPhone and iPad, Safari only offers it once the
portal has been added to the Home Screen — hence the web manifest and icons.

### Bulk import

The Admin portal takes a CSV of pupils or staff — an office already holds them in
a spreadsheet, and does not enter five hundred one form at a time.

Nothing is written until it has been seen. An upload is checked first and reported
row by row, naming the reason each rejected row cannot be accepted and showing the
identifiers every accepted row will be given; a second, explicit request commits,
in one transaction. Rows that need attention can be left out deliberately, never
by accident.

Identifiers are generated rather than trusted. Admission numbers, faculty codes and
usernames come from `server/src/lib/codes.js`, which reads the highest number in use
once and counts on from there — so a file of five hundred pupils costs one query, and
no number can repeat within the file or against what is already stored. The unique
constraints in the schema remain the real guarantee; the allocator is what keeps them
from being hit.

### Authorisation

Every protected endpoint performs five checks in order:

1. **Authentication** — JWT access token (30 min) with a rotating httpOnly refresh cookie.
2. **Role** — `requireRole(...)` for whole areas.
3. **Permission** — `requirePermission('students.edit')` against 185 permission codes
   (`module.action` across eight actions: view, create, edit, delete, approve, publish, export, manage).
4. **Resource ownership** — `assertStudentAccess`, `parentOwnsStudent`, `teacherOwnsCourse` in `lib/scope.js`.
5. **Assignment** — a teacher's reachable courses, sections and students come from `course_assignments`.

Effective permissions are read from the database on every request:
`role grants + per-user ALLOW overrides − per-user DENY overrides`. That is how the Admin can
hand one Administrator extra rights and withhold them from another (`mallikarjun` in the seed has
`students.delete`, `parents.delete` and `faculty.create` explicitly denied).

The frontend hides what a user cannot use, but it is never the gate — the API refuses the call
regardless, which is what the test suite verifies.

### Key workflows

| Workflow | Path |
|---|---|
| Admission | Student + login + parent + parent login + enrolment, in one transaction |
| Attendance | Teacher opens only their assigned register; absences notify parents |
| Marks | Teacher saves draft → submits → Administrator approves/returns → results generated → published |
| Results | Totals, percentage, grade band, class rank and attendance computed from approved marks |
| Fees | Collection writes the payment, updates the balance, posts to the income ledger and issues a numbered receipt |
| Payroll | Generated from active salary structures with attendance-based loss of pay; paying posts an expense |
| Promotion | Closes the current enrolment and opens a new one, preserving history |
| CMS | Draft content is invisible to `/api/public`; publishing makes it live immediately |

### Reports

Eleven reports, each scoped to the caller's access — a student running the attendance report gets
only their own attendance. Exports are genuine files: **CSV**, **XLSX** (ExcelJS, styled) and
**PDF** (PDFKit, paginated with headers and a summary block).

### Audit logging

Logins, failed logins, creates, edits, deletes, approvals, rejections, publications, marks
updates, attendance updates, fee payments, permission changes, role changes, password resets and
system changes — each with the acting user, role, IP, timestamp and, for changes, a before/after
diff. Viewable and filterable at **Admin → Audit Logs**.

### Security

Bcrypt password hashing, JWT with rotating single-use refresh tokens, account lockout after five
failed attempts, rate limiting (login, general API, uploads/exports), Helmet, strict CORS,
Zod validation on every write, control-character sanitisation, uploads stored under generated
names with MIME and extension allow-lists, path-traversal guards on deletion, and secrets read
only from the environment.

### Responsive design

One design system across all four sections, 320 px to 2560 px, with no horizontal page scroll.
Desktop uses a sidebar and topbar; phones get a drawer plus a bottom navigation bar on the
student and parent portals, and every table collapses into record cards below 768 px.

---

## API surface

| Area | Base path |
|---|---|
| Authentication | `/api/auth` |
| Dashboards (one per role) | `/api/dashboards` |
| Users, roles & permissions | `/api/users`, `/api/roles` |
| People | `/api/administrators`, `/api/faculty`, `/api/students`, `/api/parents` |
| Academics | `/api/academics/*` |
| Attendance & leave | `/api/attendance/*` |
| Examinations, marks, results | `/api/exams/*` |
| Fees, finance, payroll | `/api/finance/*` |
| Transport, library, inventory | `/api/transport`, `/api/library`, `/api/inventory` |
| Communication & notifications | `/api/communication/*` |
| Materials & mentoring | `/api/materials`, `/api/mentoring` |
| Reports | `/api/reports/:key?format=json\|csv\|xlsx\|pdf` |
| Website CMS | `/api/cms` (managed) · `/api/public` (public, unauthenticated) |
| System | `/api/system/audit-logs`, `/api/system/settings`, `/api/system/health` |

---

## Notes for deployment

- Set `NODE_ENV=production` and real secrets before starting; the server enforces this.
- `DATABASE_URL` is the school's cloud PostgreSQL. Without it the server falls back to a local
  PostgreSQL under `server/data/pg`, which is right for development and wrong for a school —
  set it in production. `DATABASE_POOL_MAX` (default 10) sizes the connection pool.
- `DATABASE_FILE` is only read by `npm run db:import`, which carries records over from the
  pre-PostgreSQL SQLite file.
- Uploads live in `server/uploads` and are served read-only under `/uploads`.
- `npm run db:reset` drops and rebuilds the demo dataset.
