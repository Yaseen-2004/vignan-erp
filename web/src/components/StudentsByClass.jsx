import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api/client.js';
import { DataTable } from './DataTable.jsx';
import { Icon } from './Icon.jsx';
import { useDepartment } from '../context/DepartmentContext.jsx';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  useDebounced,
  useFetch,
} from './ui.jsx';

const BOARD_LABEL = { STATE: 'State Board', CBSE: 'CBSE' };

/**
 * The student roll, class by class.
 *
 * The flat list is the right tool when you already know who you are looking
 * for; this is the right tool when you are working through a class. Two steps:
 * pick a class and section, then the students of that section — the same shape
 * as marks entry and fee collection, so the whole app is browsed the same way.
 *
 * Both steps are scoped by the API: a teacher sees only the sections assigned
 * to them, and the class cards are built from the same permitted set as the
 * table, so there is no way to reach a class through this page that the flat
 * list would refuse.
 */
export function StudentsByClass({ basePath = '/administrator' }) {
  const navigate = useNavigate();
  const dept = useDepartment();
  const board = dept?.department && dept.department !== 'ALL' ? dept.department : '';

  const [selected, setSelected] = useState(null); // { class_name, section_id, section_name, board }
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);

  const { data: classes, loading, error, refetch } = useFetch(
    () => api.get(`/students/by-class${qs({ board })}`),
    [board]
  );

  const {
    data: students,
    meta,
    loading: studentsLoading,
    error: studentsError,
    refetch: refetchStudents,
  } = useFetch(
    () =>
      api.get(
        `/students${qs({
          section_id: selected.section_id,
          class_id: selected.section_id ? undefined : selected.class_id,
          search: debounced,
          status: 'ACTIVE',
          page,
          limit: 50,
        })}`
      ),
    [selected?.section_id, selected?.class_id, debounced, page],
    { skip: !selected }
  );

  // Classes arrive ordered by board then level; split them into their wings.
  const wings = useMemo(() => {
    const grouped = new Map();
    for (const klass of classes || []) {
      if (!grouped.has(klass.board)) grouped.set(klass.board, []);
      grouped.get(klass.board).push(klass);
    }
    return [...grouped.entries()];
  }, [classes]);

  const openSection = (klass, section) => {
    setSelected({
      class_id: klass.class_id,
      class_name: klass.class_name,
      board: klass.board,
      stream: klass.stream,
      class_teacher: klass.class_teacher,
      section_id: section?.section_id ?? null,
      section_name: section?.section_name ?? null,
      students: section ? section.students : klass.students,
    });
    setSearch('');
    setPage(1);
  };

  /* ------------------------------------------------ step 2: the students */
  if (selected) {
    return (
      <Card bodyClass="flush">
        <div className="row row-wrap" style={{ gap: 12, padding: 'var(--sp-4)', alignItems: 'center' }}>
          <Button size="sm" variant="secondary" icon="arrow-left" onClick={() => setSelected(null)}>
            All classes
          </Button>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 'var(--text-lg)' }}>
              {selected.class_name}
              {selected.section_name ? ` · Section ${selected.section_name}` : ''}
            </strong>
            <div className="text-xs text-muted">
              {BOARD_LABEL[selected.board] || selected.board}
              {selected.stream ? ` · ${selected.stream}` : ''}
              {selected.class_teacher ? ` · Class teacher: ${selected.class_teacher}` : ''}
            </div>
          </div>
          <div className="toolbar-spacer" style={{ flex: 1 }} />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search within this class"
            style={{ maxWidth: 240 }}
          />
          <Button size="sm" variant="ghost" icon="refresh" onClick={refetchStudents} aria-label="Refresh" />
        </div>

        <DataTable
          onRowClick={(row) => navigate(`${basePath}/students/${row.id}`)}
          loading={studentsLoading}
          error={studentsError}
          onRetry={refetchStudents}
          rows={students}
          meta={meta}
          onPageChange={setPage}
          emptyTitle="No students"
          emptyMessage="No student in this class matches your search."
          columns={[
            {
              key: 'roll_number',
              label: 'Roll',
              render: (row) => <span className="mono">{row.roll_number || '—'}</span>,
            },
            {
              key: 'student',
              label: 'Student',
              render: (row) => (
                <div className="row-person">
                  <Avatar name={row.full_name} src={row.photo} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-primary truncate">{row.full_name}</div>
                    <div className="cell-sub mono">{row.admission_number}</div>
                  </div>
                </div>
              ),
            },
            { key: 'gender', label: 'Gender', render: (row) => row.gender || '—' },
            { key: 'phone', label: 'Contact', render: (row) => row.phone || '—' },
            { key: 'mentor_name', label: 'Mentor', render: (row) => row.mentor_name || '—' },
            {
              key: 'status',
              label: 'Status',
              badge: true,
              render: (row) => <Badge status={row.status}>{row.status}</Badge>,
            },
          ]}
          mobileColumns={['roll_number', 'gender', 'status']}
        />
      </Card>
    );
  }

  /* -------------------------------------------------- step 1: the classes */
  if (loading || (!classes && !error)) {
    return (
      <Card>
        <Skeleton variant="row" count={6} />
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={refetch} />
      </Card>
    );
  }
  if (!classes.length) {
    return (
      <Card>
        <EmptyState
          icon="graduation-cap"
          title="No classes to show"
          message="No class with enrolled students is available to you."
        />
      </Card>
    );
  }

  return (
    <div className="stack">
      {wings.map(([wing, list]) => {
        const total = list.reduce((sum, klass) => sum + klass.students, 0);
        return (
          <Card
            key={wing}
            title={BOARD_LABEL[wing] || wing}
            hint={`${list.length} ${list.length === 1 ? 'class' : 'classes'} · ${total} students`}
          >
            <div className="class-grid">
              {list.map((klass) => (
                <div className="class-card" key={klass.class_id}>
                  <button
                    type="button"
                    className="head"
                    onClick={() => openSection(klass, klass.sections.length === 1 ? klass.sections[0] : null)}
                  >
                    <span className="level">{klass.numeric_level ?? '—'}</span>
                    <span className="name">
                      <strong>{klass.class_name}</strong>
                      <span>
                        {klass.stream ? `${klass.stream} · ` : ''}
                        {klass.students} {klass.students === 1 ? 'student' : 'students'}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </button>

                  <div className="split">
                    <span title="Boys">
                      <Icon name="user" size={11} /> {klass.boys} boys
                    </span>
                    <span title="Girls">
                      <Icon name="user" size={11} /> {klass.girls} girls
                    </span>
                  </div>

                  {klass.class_teacher && (
                    <div className="teacher" title="Class teacher">
                      <Icon name="user-check" size={12} /> {klass.class_teacher}
                    </div>
                  )}

                  {klass.sections.length > 1 && (
                    <div className="sections">
                      {klass.sections.map((section) => (
                        <button
                          key={section.section_id ?? 'none'}
                          type="button"
                          className="section-chip"
                          onClick={() => openSection(klass, section)}
                        >
                          {section.section_name ? `Section ${section.section_name}` : 'Unassigned'}
                          <span>{section.students}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export default StudentsByClass;
