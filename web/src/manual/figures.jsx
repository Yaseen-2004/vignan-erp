/**
 * Manual figures.
 *
 * Each figure is a hand-drawn schematic of a real screen — drawn rather than
 * screenshotted so that it stays correct when the theme changes, prints
 * cleanly, and adds nothing to the bundle beyond markup. Colours come from
 * `currentColor` and the CSS variables the manual sets, so a figure reads the
 * same in light and dark.
 *
 * Callouts are numbered ①②③… and the numbers are explained in the step list
 * beside the figure, in both languages.
 */

const VB = { viewBox: '0 0 640 380', role: 'img', preserveAspectRatio: 'xMidYMid meet' };

/** A numbered callout bubble. */
function Pin({ x, y, n }) {
  return (
    <g className="fig-pin">
      <circle cx={x} cy={y} r="11" />
      <text x={x} y={y + 4} textAnchor="middle">
        {n}
      </text>
    </g>
  );
}

/** The window chrome every figure sits inside. */
function Frame({ title, children }) {
  return (
    <>
      <rect className="fig-page" x="1" y="1" width="638" height="378" rx="10" />
      <rect className="fig-bar" x="1" y="1" width="638" height="30" rx="10" />
      <rect className="fig-bar" x="1" y="20" width="638" height="11" />
      <circle className="fig-dot" cx="18" cy="16" r="4" />
      <circle className="fig-dot" cx="32" cy="16" r="4" />
      <circle className="fig-dot" cx="46" cy="16" r="4" />
      <text className="fig-title" x="64" y="20">
        {title}
      </text>
      {children}
    </>
  );
}

/** The dark sidebar, present on every desktop screen. */
function Sidebar({ active = 3, labels = ['', '', '', '', '', ''] }) {
  return (
    <g>
      <rect className="fig-side" x="1" y="31" width="132" height="348" />
      <rect className="fig-logo" x="14" y="44" width="26" height="26" rx="7" />
      <rect className="fig-side-txt" x="48" y="49" width="60" height="7" rx="3" />
      <rect className="fig-side-txt dim" x="48" y="60" width="42" height="5" rx="2" />
      {labels.map((label, i) => {
        const y = 92 + i * 30;
        return (
          <g key={i}>
            {i === active && <rect className="fig-side-active" x="8" y={y - 11} width="118" height="24" rx="6" />}
            <rect className={`fig-side-icon${i === active ? ' on' : ''}`} x="16" y={y - 6} width="13" height="13" rx="3" />
            <rect
              className={`fig-side-txt${i === active ? '' : ' dim'}`}
              x="36"
              y={y - 4}
              width={label || 70 - (i % 3) * 12}
              height="8"
              rx="3"
            />
          </g>
        );
      })}
    </g>
  );
}

/** A stat tile row, as used at the top of every dashboard. */
function Stats({ y = 46, n = 4 }) {
  const w = (486 - (n - 1) * 10) / n;
  return (
    <g>
      {Array.from({ length: n }).map((_, i) => {
        const x = 148 + i * (w + 10);
        return (
          <g key={i}>
            <rect className="fig-card" x={x} y={y} width={w} height="62" rx="8" />
            <rect className="fig-line dim" x={x + 12} y={y + 14} width={w - 46} height="6" rx="3" />
            <rect className="fig-line strong" x={x + 12} y={y + 28} width={w - 62} height="13" rx="4" />
            <rect className="fig-chip" x={x + w - 30} y={y + 12} width="18" height="18" rx="5" />
          </g>
        );
      })}
    </g>
  );
}

/** A generic list table: header strip, rows, and an action column. */
function Table({ y, rows = 5, actions = true, title = true }) {
  return (
    <g>
      <rect className="fig-card" x="148" y={y} width="480" height={30 + rows * 26 + 14} rx="8" />
      {title && <rect className="fig-line strong" x="164" y={y + 13} width="120" height="9" rx="4" />}
      <rect className="fig-head" x="149" y={y + 32} width="478" height="22" />
      {['Name', 'Class', 'Status'].map((_, i) => (
        <rect key={i} className="fig-line dim" x={164 + i * 130} y={y + 39} width="52" height="7" rx="3" />
      ))}
      {Array.from({ length: rows }).map((_, r) => (
        <g key={r}>
          <rect className="fig-row" x="149" y={y + 54 + r * 26} width="478" height="26" />
          <circle className="fig-avatar" cx="172" cy={y + 67 + r * 26} r="8" />
          <rect className="fig-line" x="186" y={y + 63 + r * 26} width={70 - (r % 3) * 10} height="7" rx="3" />
          <rect className="fig-line dim" x="294" y={y + 63 + r * 26} width="46" height="7" rx="3" />
          <rect className={`fig-badge ${r % 3 === 2 ? 'warn' : 'ok'}`} x="424" y={y + 60 + r * 26} width="52" height="13" rx="6" />
          {actions && (
            <g>
              <rect className="fig-btn ghost" x="540" y={y + 60 + r * 26} width="38" height="14" rx="4" />
              <rect className="fig-btn ghost" x="583" y={y + 60 + r * 26} width="38" height="14" rx="4" />
            </g>
          )}
        </g>
      ))}
    </g>
  );
}

/* ===================================================================== */
/*  FIGURES                                                              */
/* ===================================================================== */

/** Signing in. */
export function FigLogin() {
  return (
    <svg {...VB} className="fig">
      <Frame title="localhost:5173/login">
        <rect className="fig-hero" x="1" y="31" width="638" height="348" />
        <rect className="fig-card" x="196" y="72" width="248" height="266" rx="12" />
        <rect className="fig-logo" x="304" y="94" width="32" height="32" rx="9" />
        <rect className="fig-line strong" x="248" y="140" width="144" height="11" rx="5" />
        <rect className="fig-line dim" x="268" y="158" width="104" height="7" rx="3" />

        <rect className="fig-line dim" x="220" y="186" width="52" height="6" rx="3" />
        <rect className="fig-input" x="220" y="196" width="200" height="26" rx="6" />
        <rect className="fig-line dim" x="220" y="234" width="60" height="6" rx="3" />
        <rect className="fig-input" x="220" y="244" width="200" height="26" rx="6" />
        <rect className="fig-btn primary" x="220" y="286" width="200" height="30" rx="7" />
        <Pin x={230} y={209} n="1" />
        <Pin x={230} y={257} n="2" />
        <Pin x={410} y={301} n="3" />
      </Frame>
    </svg>
  );
}

/** The shell: sidebar, header, content. */
export function FigShell() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Portal">
        <Sidebar active={2} />
        <rect className="fig-topbar" x="133" y="31" width="506" height="34" />
        <rect className="fig-input" x="148" y="40" width="150" height="17" rx="8" />
        <circle className="fig-chip" cx="560" cy="48" r="9" />
        <circle className="fig-chip" cx="588" cy="48" r="9" />
        <circle className="fig-avatar" cx="616" cy="48" r="10" />
        <rect className="fig-line strong" x="148" y="80" width="150" height="12" rx="5" />
        <rect className="fig-line dim" x="148" y="98" width="230" height="7" rx="3" />
        <Stats y={118} />
        <Table y={192} rows={4} />
        <Pin x={66} y={126} n="1" />
        <Pin x={186} y={49} n="2" />
        <Pin x={616} y={30} n="3" />
        <Pin x={160} y={130} n="4" />
      </Frame>
    </svg>
  );
}

/** A list page with search, filters and Add. */
export function FigList() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Student List">
        <Sidebar active={2} />
        <rect className="fig-line strong" x="148" y="52" width="140" height="12" rx="5" />
        <rect className="fig-btn primary" x="546" y="46" width="82" height="24" rx="6" />
        <rect className="fig-input" x="148" y="82" width="196" height="24" rx="6" />
        <rect className="fig-input" x="352" y="82" width="110" height="24" rx="6" />
        <rect className="fig-input" x="470" y="82" width="82" height="24" rx="6" />
        <rect className="fig-btn ghost" x="560" y="82" width="68" height="24" rx="6" />
        <Table y={118} rows={7} title={false} />
        <Pin x={598} y={44} n="1" />
        <Pin x={158} y={94} n="2" />
        <Pin x={404} y={76} n="3" />
        <Pin x={598} y={210} n="4" />
      </Frame>
    </svg>
  );
}

/** The add/edit dialog. */
export function FigForm() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Add Student">
        <Sidebar active={2} />
        <Table y={46} rows={6} />
        <rect className="fig-scrim" x="1" y="31" width="638" height="348" />
        <rect className="fig-card raised" x="150" y="56" width="380" height="298" rx="12" />
        <rect className="fig-line strong" x="170" y="76" width="130" height="11" rx="5" />
        <rect className="fig-chip" x="498" y="72" width="16" height="16" rx="5" />
        <line className="fig-rule" x1="150" y1="102" x2="530" y2="102" />
        {[0, 1, 2].map((r) =>
          [0, 1].map((c) => (
            <g key={`${r}-${c}`}>
              <rect className="fig-line dim" x={170 + c * 190} y={118 + r * 54} width="58" height="6" rx="3" />
              <rect className="fig-input" x={170 + c * 190} y={128 + r * 54} width="170" height="24" rx="6" />
            </g>
          ))
        )}
        <rect className="fig-line dim" x="170" y="280" width="58" height="6" rx="3" />
        <rect className="fig-input" x="170" y="290" width="340" height="24" rx="6" />
        <line className="fig-rule" x1="150" y1="326" x2="530" y2="326" />
        <rect className="fig-btn ghost" x="374" y="334" width="62" height="14" rx="4" />
        <rect className="fig-btn primary" x="446" y="334" width="66" height="14" rx="4" />
        <Pin x={182} y={140} n="1" />
        <Pin x={362} y={140} n="2" />
        <Pin x={500} y={341} n="3" />
        <Pin x={506} y={80} n="4" />
      </Frame>
    </svg>
  );
}

/** Marking attendance: the Present / Absent register. */
export function FigAttendance() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Mark Attendance">
        <Sidebar active={3} />
        <rect className="fig-line strong" x="148" y="48" width="150" height="12" rx="5" />
        <rect className="fig-card" x="148" y="72" width="480" height="46" rx="8" />
        {['Course', 'Date', 'Period'].map((_, i) => (
          <g key={i}>
            <rect className="fig-line dim" x={164 + i * 132} y={82} width="44" height="6" rx="3" />
            <rect className="fig-input" x={164 + i * 132} y={92} width="118" height="20" rx="5" />
          </g>
        ))}
        <rect className="fig-btn ghost" x="560" y="86" width="56" height="24" rx="6" />

        <rect className="fig-card" x="148" y="128" width="480" height="228" rx="8" />
        <rect className="fig-btn ok" x="164" y="140" width="66" height="18" rx="5" />
        <rect className="fig-btn danger" x="238" y="140" width="66" height="18" rx="5" />
        <rect className="fig-btn ghost" x="312" y="140" width="92" height="18" rx="5" />
        <rect className="fig-btn primary" x="546" y="140" width="70" height="18" rx="5" />
        {Array.from({ length: 6 }).map((_, r) => (
          <g key={r}>
            <rect className="fig-row" x="149" y={172 + r * 28} width="478" height="28" />
            <rect className="fig-line dim" x="164" y={182 + r * 28} width="18" height="7" rx="3" />
            <circle className="fig-avatar" cx="200" cy={186 + r * 28} r="8" />
            <rect className="fig-line" x="216" y={182 + r * 28} width={92 - (r % 3) * 14} height="7" rx="3" />
            <rect className={`fig-toggle ${r === 4 ? 'off' : 'on'}`} x="440" y={177 + r * 28} width="70" height="17" rx="8" />
            <rect className={`fig-toggle ${r === 4 ? 'on-danger' : 'off'}`} x="518" y={177 + r * 28} width="70" height="17" rx="8" />
          </g>
        ))}
        <Pin x={172} y={104} n="1" />
        <Pin x={352} y={132} n="2" />
        <Pin x={474} y={186} n="3" />
        <Pin x={598} y={132} n="4" />
      </Frame>
    </svg>
  );
}

/** Marks entry: class → section → students. */
export function FigMarks() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Enter Marks">
        <Sidebar active={4} />
        <rect className="fig-line strong" x="148" y="48" width="120" height="12" rx="5" />
        <rect className="fig-input" x="440" y="42" width="188" height="24" rx="6" />

        {/* class → section cards */}
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect className="fig-card" x={148 + i * 162} y="80" width="152" height="76" rx="8" />
            <rect className="fig-line strong" x={162 + i * 162} y="92" width="72" height="9" rx="4" />
            <rect className="fig-line dim" x={162 + i * 162} y="108" width="104" height="6" rx="3" />
            <rect className={`fig-badge ${i === 0 ? 'ok' : i === 1 ? 'warn' : 'dim'}`} x={162 + i * 162} y="124" width="60" height="14" rx="7" />
            <rect className="fig-btn primary" x={230 + i * 162} y="124" width="56" height="14" rx="4" />
          </g>
        ))}

        {/* the sheet */}
        <rect className="fig-card" x="148" y="170" width="480" height="188" rx="8" />
        <rect className="fig-head" x="149" y="171" width="478" height="24" />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} className="fig-line dim" x={164 + i * 118} y="179" width="56" height="7" rx="3" />
        ))}
        {Array.from({ length: 5 }).map((_, r) => (
          <g key={r}>
            <rect className="fig-row" x="149" y={195 + r * 28} width="478" height="28" />
            <rect className="fig-line dim" x="164" y={205 + r * 28} width="16" height="7" rx="3" />
            <rect className="fig-line" x="192" y={205 + r * 28} width={94 - (r % 3) * 12} height="7" rx="3" />
            <rect className="fig-input" x="400" y={200 + r * 28} width="54" height="18" rx="5" />
            <rect className={`fig-badge ${r === 3 ? 'warn' : 'ok'}`} x="472" y={202 + r * 28} width="44" height="13" rx="6" />
            <rect className="fig-line dim" x="540" y={205 + r * 28} width="60" height="7" rx="3" />
          </g>
        ))}
        <rect className="fig-btn ghost" x="470" y="338" width="66" height="14" rx="4" />
        <rect className="fig-btn primary" x="546" y="338" width="72" height="14" rx="4" />
        <Pin x={534} y={54} n="1" />
        <Pin x={160} y={92} n="2" />
        <Pin x={412} y={214} n="3" />
        <Pin x={598} y={332} n="4" />
      </Frame>
    </svg>
  );
}

/** Fee collection: search, then the student's fee account. */
export function FigFees() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Fee Collection">
        <Sidebar active={1} />
        <rect className="fig-card" x="148" y="44" width="480" height="72" rx="8" />
        <circle className="fig-avatar" cx="180" cy="80" r="20" />
        <rect className="fig-line strong" x="210" y="62" width="120" height="11" rx="5" />
        <rect className="fig-badge ok" x="210" y="82" width="52" height="14" rx="7" />
        <rect className="fig-badge dim" x="270" y="82" width="52" height="14" rx="7" />
        <rect className="fig-badge dim" x="330" y="82" width="52" height="14" rx="7" />
        <rect className="fig-btn ghost" x="546" y="70" width="70" height="20" rx="5" />

        <Stats y={126} n={4} />

        <rect className="fig-card" x="148" y="200" width="480" height="158" rx="8" />
        <rect className="fig-line strong" x="164" y="212" width="86" height="9" rx="4" />
        <rect className="fig-head" x="149" y="230" width="478" height="22" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} className="fig-line dim" x={164 + i * 96} y="237" width="44" height="7" rx="3" />
        ))}
        {Array.from({ length: 3 }).map((_, r) => (
          <g key={r}>
            <rect className="fig-row" x="149" y={252 + r * 32} width="478" height="32" />
            <rect className="fig-line" x="164" y={264 + r * 32} width="88" height="7" rx="3" />
            <rect className="fig-line dim" x="272" y={264 + r * 32} width="52" height="7" rx="3" />
            <rect className="fig-line strong" x="356" y={262 + r * 32} width="46" height="9" rx="4" />
            <rect className={`fig-badge ${r === 1 ? 'danger' : 'ok'}`} x="428" y={261 + r * 32} width="60" height="13" rx="6" />
            <rect className="fig-btn primary" x="546" y={259 + r * 32} width="66" height="17" rx="5" />
          </g>
        ))}
        <Pin x={196} y={54} n="1" />
        <Pin x={382} y={140} n="2" />
        <Pin x={598} y={210} n="3" />
        <Pin x={532} y={272} n="4" />
      </Frame>
    </svg>
  );
}

/** The student/parent dashboard. */
export function FigPortal() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Dashboard">
        <Sidebar active={0} />
        <rect className="fig-hero" x="148" y="44" width="480" height="76" rx="10" />
        <circle className="fig-avatar light" cx="184" cy="82" r="22" />
        <rect className="fig-line on-hero" x="218" y="64" width="150" height="11" rx="5" />
        <rect className="fig-line on-hero dim" x="218" y="84" width="210" height="7" rx="3" />
        <rect className="fig-badge on-hero" x="218" y="98" width="56" height="13" rx="6" />
        <rect className="fig-badge on-hero" x="282" y="98" width="56" height="13" rx="6" />

        <Stats y={132} n={4} />

        <rect className="fig-card" x="148" y="206" width="234" height="152" rx="8" />
        <rect className="fig-line strong" x="164" y="220" width="90" height="9" rx="4" />
        {Array.from({ length: 4 }).map((_, r) => (
          <g key={r}>
            <rect className="fig-line" x="164" y={244 + r * 26} width={110 - r * 10} height="7" rx="3" />
            <rect className="fig-badge ok" x="308" y={241 + r * 26} width="56" height="13" rx="6" />
          </g>
        ))}
        <rect className="fig-card" x="394" y="206" width="234" height="152" rx="8" />
        <rect className="fig-line strong" x="410" y="220" width="90" height="9" rx="4" />
        {Array.from({ length: 4 }).map((_, r) => (
          <g key={r}>
            <rect className="fig-chip" x="410" y={238 + r * 26} width="14" height="14" rx="4" />
            <rect className="fig-line" x="432" y={242 + r * 26} width={140 - r * 16} height="7" rx="3" />
          </g>
        ))}
        <Pin x={162} y={56} n="1" />
        <Pin x={382} y={148} n="2" />
        <Pin x={160} y={218} n="3" />
        <Pin x={406} y={218} n="4" />
      </Frame>
    </svg>
  );
}

/** Course materials: view and download. */
export function FigMaterials() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Course Materials">
        <Sidebar active={2} />
        <rect className="fig-line strong" x="148" y="48" width="140" height="12" rx="5" />
        <rect className="fig-input" x="148" y="76" width="200" height="24" rx="6" />
        <rect className="fig-input" x="356" y="76" width="128" height="24" rx="6" />
        <rect className="fig-btn primary" x="546" y="76" width="82" height="24" rx="6" />
        {Array.from({ length: 5 }).map((_, r) => (
          <g key={r}>
            <rect className="fig-card" x="148" y={116 + r * 48} width="480" height="40" rx="8" />
            <rect className="fig-chip" x="164" y={126 + r * 48} width="22" height="22" rx="6" />
            <rect className="fig-line" x="196" y={128 + r * 48} width={150 - r * 12} height="8" rx="3" />
            <rect className="fig-line dim" x="196" y={142 + r * 48} width={110 - r * 8} height="6" rx="3" />
            <rect className={`fig-badge ${r === 4 ? 'warn' : 'ok'}`} x="400" y={130 + r * 48} width="62" height="13" rx="6" />
            <rect className="fig-btn ghost" x="478" y={129 + r * 48} width="60" height="15" rx="4" />
            <rect className="fig-btn primary" x="548" y={129 + r * 48} width="68" height="15" rx="4" />
          </g>
        ))}
        <Pin x={252} y={88} n="1" />
        <Pin x={598} y={70} n="2" />
        <Pin x={436} y={124} n="3" />
        <Pin x={598} y={122} n="4" />
      </Frame>
    </svg>
  );
}

/** A printed document — report card or receipt. */
export function FigDocument() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Report Card / Receipt">
        <rect className="fig-hero" x="1" y="31" width="638" height="348" />
        <rect className="fig-btn ghost" x="466" y="44" width="76" height="20" rx="5" />
        <rect className="fig-btn primary" x="552" y="44" width="76" height="20" rx="5" />
        <rect className="fig-paper" x="168" y="76" width="304" height="288" rx="4" />
        <rect className="fig-logo" x="196" y="94" width="26" height="26" rx="7" />
        <rect className="fig-line strong" x="238" y="96" width="150" height="10" rx="4" />
        <rect className="fig-line dim" x="238" y="112" width="118" height="6" rx="3" />
        <line className="fig-rule dark" x1="188" y1="132" x2="452" y2="132" />
        {[0, 1].map((c) =>
          [0, 1, 2].map((r) => (
            <g key={`${c}-${r}`}>
              <rect className="fig-line dim" x={190 + c * 136} y={146 + r * 16} width="42" height="6" rx="3" />
              <rect className="fig-line" x={238 + c * 136} y={146 + r * 16} width="52" height="6" rx="3" />
            </g>
          ))
        )}
        <rect className="fig-head dark" x="188" y="204" width="264" height="16" />
        {Array.from({ length: 5 }).map((_, r) => (
          <g key={r}>
            <line className="fig-rule dark" x1="188" y1={236 + r * 18} x2="452" y2={236 + r * 18} />
            <rect className="fig-line" x="196" y={224 + r * 18} width="86" height="6" rx="3" />
            <rect className="fig-line dim" x="306" y={224 + r * 18} width="40" height="6" rx="3" />
            <rect className="fig-line dim" x="380" y={224 + r * 18} width="40" height="6" rx="3" />
          </g>
        ))}
        <rect className="fig-line dim" x="356" y="336" width="82" height="6" rx="3" />
        <line className="fig-rule dark" x1="348" y1="330" x2="446" y2="330" />
        <Pin x={598} y={38} n="1" />
        <Pin x={182} y={90} n="2" />
        <Pin x={182} y={212} n="3" />
        <Pin x={332} y={344} n="4" />
      </Frame>
    </svg>
  );
}

/** Roles and permissions matrix — Admin only. */
export function FigPermissions() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Roles & Permissions">
        <Sidebar active={5} />
        <rect className="fig-line strong" x="148" y="48" width="170" height="12" rx="5" />
        <rect className="fig-card" x="148" y="72" width="128" height="286" rx="8" />
        {Array.from({ length: 6 }).map((_, r) => (
          <g key={r}>
            {r === 1 && <rect className="fig-side-active light" x="156" y={84 + r * 34} width="112" height="26" rx="6" />}
            <rect className={`fig-line${r === 1 ? ' strong' : ' dim'}`} x="168" y={94 + r * 34} width={82 - (r % 3) * 12} height="8" rx="3" />
          </g>
        ))}
        <rect className="fig-card" x="288" y="72" width="340" height="286" rx="8" />
        <rect className="fig-input" x="302" y="86" width="200" height="22" rx="6" />
        <rect className="fig-btn primary" x="546" y="86" width="68" height="22" rx="6" />
        {Array.from({ length: 6 }).map((_, r) => (
          <g key={r}>
            <rect className="fig-row" x="289" y={122 + r * 38} width="338" height="38" />
            <rect className="fig-line" x="302" y={134 + r * 38} width={120 - (r % 4) * 14} height="8" rx="3" />
            <rect className="fig-line dim" x="302" y={148 + r * 38} width={168 - (r % 3) * 20} height="6" rx="3" />
            {[0, 1, 2, 3].map((c) => (
              <rect
                key={c}
                className={`fig-check ${(r + c) % 3 === 0 ? 'off' : 'on'}`}
                x={490 + c * 34}
                y={132 + r * 38}
                width="16"
                height="16"
                rx="4"
              />
            ))}
          </g>
        ))}
        <Pin x={162} y={100} n="1" />
        <Pin x={314} y={78} n="2" />
        <Pin x={498} y={124} n="3" />
        <Pin x={598} y={78} n="4" />
      </Frame>
    </svg>
  );
}

/** Reports and exports. */
export function FigReports() {
  return (
    <svg {...VB} className="fig">
      <Frame title="Reports">
        <Sidebar active={4} />
        <rect className="fig-line strong" x="148" y="48" width="110" height="12" rx="5" />
        <rect className="fig-card" x="148" y="72" width="480" height="52" rx="8" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect className="fig-line dim" x={164 + i * 122} y="82" width="42" height="6" rx="3" />
            <rect className="fig-input" x={164 + i * 122} y="92" width="108" height="22" rx="5" />
          </g>
        ))}
        <rect className="fig-btn ghost" x="472" y="92" width="66" height="22" rx="5" />
        <rect className="fig-btn primary" x="548" y="92" width="68" height="22" rx="5" />

        <rect className="fig-card" x="148" y="136" width="234" height="118" rx="8" />
        {[52, 78, 40, 92, 64, 84].map((h, i) => (
          <rect key={i} className="fig-bar-col" x={172 + i * 34} y={236 - h} width="20" height={h} rx="4" />
        ))}
        <rect className="fig-card" x="394" y="136" width="234" height="118" rx="8" />
        <circle className="fig-donut" cx="470" cy="196" r="38" />
        {Array.from({ length: 4 }).map((_, i) => (
          <g key={i}>
            <rect className="fig-chip" x="530" y={168 + i * 20} width="10" height="10" rx="3" />
            <rect className="fig-line dim" x="546" y={170 + i * 20} width={62 - i * 8} height="6" rx="3" />
          </g>
        ))}
        <Table y={266} rows={2} title={false} actions={false} />
        <Pin x={226} y={104} n="1" />
        <Pin x={598} y={86} n="2" />
        <Pin x={160} y={148} n="3" />
        <Pin x={598} y={276} n="4" />
      </Frame>
    </svg>
  );
}

/** The manual figure registry, addressed by key from the content file. */
export const FIGURES = {
  login: FigLogin,
  shell: FigShell,
  list: FigList,
  form: FigForm,
  attendance: FigAttendance,
  marks: FigMarks,
  fees: FigFees,
  portal: FigPortal,
  materials: FigMaterials,
  document: FigDocument,
  permissions: FigPermissions,
  reports: FigReports,
};

export function Figure({ name }) {
  const Component = FIGURES[name];
  return Component ? <Component /> : null;
}
