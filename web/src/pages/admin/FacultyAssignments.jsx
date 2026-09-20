import { useMemo, useState } from 'react';
import { api, qs } from '../../api/client.js';
import { Icon } from '../../components/Icon.jsx';
import { useDepartment } from '../../context/DepartmentContext.jsx';
import { useLookups } from '../../hooks/useLookups.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  TableWrap,
  useDebounced,
  useFetch,
} from '../../components/ui.jsx';

const BOARD_LABEL = { STATE: 'State Board', CBSE: 'CBSE' };

const boardBadge = (board) =>
  board ? (
    <Badge tone={board === 'CBSE' ? 'purple' : 'info'} dot={false}>
      {BOARD_LABEL[board] || board}
    </Badge>
  ) : null;

/**
 * Faculty assignments — who teaches and mentors whom.
 *
 * Course assignment, class teacher and mentor were each edited one record at a
 * time, from three different pages. Here it is the other way round: pick a
 * member of faculty, see everything they hold, and hand over a whole class or a
 * set of students in one action.
 *
 * It writes the same three tables as before, under the same permissions, so a
 * teacher's access still follows from their assignments and nothing new is
 * granted by this page existing.
 */
export function FacultyAssignments() {
  const toast = useToast();
  const dept = useDepartment();
  const { lookups } = useLookups();
  const board = dept?.department || '';

  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [facultyId, setFacultyId] = useState(null);
  const [nonce, setNonce] = useState(0);
  const bump = () => setNonce((n) => n + 1);

  const [dialog, setDialog] = useState(null); // 'courses' | 'classes' | 'mentees'
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: staff, loading, error, refetch } = useFetch(
    () => api.get(`/assignments/faculty${qs({ board, search: debounced })}`),
    [board, debounced, nonce]
  );

  const { data: detail, loading: detailLoading, refetch: refetchDetail } = useFetch(
    () => api.get(`/assignments/faculty/${facultyId}`),
    [facultyId, nonce],
    { skip: !facultyId }
  );

  const { data: gaps } = useFetch(() => api.get('/assignments/gaps'), [nonce]);


  const reload = () => {
    bump();
    refetch();
    if (facultyId) refetchDetail();
  };

  const removeCourse = async (row) => {
    setBusy(true);
    try {
      await api.delete(`/assignments/course-assignments/${row.id}`);
      toast.success('Course removed', `${row.subject_name} — ${row.class_name} ${row.section_name}`);
      reload();
    } catch (e) {
      toast.error('Could not remove the course', e.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const removeClass = async (row) => {
    setBusy(true);
    try {
      await api.delete(`/assignments/classes/${row.class_id}/class-teacher`);
      toast.success('Class teacher removed', row.class_name);
      reload();
    } catch (e) {
      toast.error('Could not remove the class teacher', e.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const removeMentee = async (row) => {
    setBusy(true);
    try {
      await api.delete(`/assignments/faculty/${facultyId}/mentees/${row.id}`);
      toast.success('Mentee removed', row.full_name);
      reload();
    } catch (e) {
      toast.error('Could not remove the mentee', e.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Faculty Assignments"
        subtitle="Assign courses, a class or students to a member of faculty. Assignment is what grants their access."
        actions={<Button variant="secondary" icon="refresh" onClick={reload}>Refresh</Button>}
      />

      <div className="grid grid-stats">
        <Stat label="Teaching staff" value={staff?.length ?? '—'} icon="briefcase" tone="navy" />
        <Stat
          label="Classes without a teacher"
          value={gaps?.classesWithoutTeacher?.length ?? '—'}
          icon="alert-circle"
          tone={gaps?.classesWithoutTeacher?.length ? 'red' : 'green'}
          meta={gaps?.classesWithoutTeacher?.length ? 'Name a class teacher' : 'All classes covered'}
        />
        <Stat
          label="Courses unassigned"
          value={gaps?.coursesWithoutTeacher ?? '—'}
          icon="book-open"
          tone={gaps?.coursesWithoutTeacher ? 'red' : 'green'}
        />
        <Stat
          label="Students without a mentor"
          value={gaps?.studentsWithoutMentor ?? '—'}
          icon="compass"
          tone={gaps?.studentsWithoutMentor ? 'red' : 'green'}
        />
      </div>

      <div className="assign-layout">
        {/* ------------------------------------------- the faculty rail */}
        <Card bodyClass="flush">
          <div style={{ padding: 'var(--sp-3)' }}>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search teaching staff"
            />
          </div>

          {loading || (!staff && !error) ? (
            <div style={{ padding: 12 }}>
              <Skeleton variant="row" count={6} />
            </div>
          ) : error ? (
            <div style={{ padding: 16 }}>
              <ErrorState error={error} onRetry={refetch} />
            </div>
          ) : !staff.length ? (
            <EmptyState icon="briefcase" title="No teaching staff" message="No one matches that search." />
          ) : (
            <div className="faculty-rail">
              {staff.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className={`faculty-row${person.id === facultyId ? ' on' : ''}`}
                  onClick={() => setFacultyId(person.id)}
                >
                  <Avatar name={person.full_name} src={person.photo} size="sm" />
                  <span className="who">
                    <strong>{person.full_name}</strong>
                    <span>{person.designation || person.faculty_code}</span>
                  </span>
                  <span className="counts">
                    <span title="Courses">{person.courses}c</span>
                    <span title="Classes as class teacher">{person.classes_owned}k</span>
                    <span title="Mentees">{person.mentees}m</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* ------------------------------------ what this person holds */}
        <div className="stack">
          {!facultyId ? (
            <Card>
              <EmptyState
                icon="user-check"
                title="Choose a member of faculty"
                message="Pick someone on the left to see and change what they teach and mentor."
              />
            </Card>
          ) : detailLoading || !detail ? (
            <Card>
              <Skeleton variant="row" count={8} />
            </Card>
          ) : (
            <>
              <Card>
                <div className="row row-wrap" style={{ gap: 14, alignItems: 'center' }}>
                  <Avatar name={detail.faculty.full_name} size="lg" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h2 style={{ fontSize: 'var(--text-xl)' }}>{detail.faculty.full_name}</h2>
                    <div className="row row-wrap mt-2" style={{ gap: 8 }}>
                      <Badge tone="neutral" dot={false}>{detail.faculty.faculty_code}</Badge>
                      <Badge tone="neutral" dot={false}>{detail.faculty.designation || 'Teacher'}</Badge>
                      {detail.faculty.board && detail.faculty.board !== 'BOTH'
                        ? boardBadge(detail.faculty.board)
                        : (
                          <Badge tone="neutral" dot={false}>Both departments</Badge>
                        )}
                    </div>
                  </div>
                </div>
              </Card>

              {/* ------------------------------------------- courses */}
              <Card
                title="Courses taught"
                hint="A course assignment gives this teacher that subject's students, and only those."
                actions={
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setDialog('courses')}>
                    Assign courses
                  </Button>
                }
                bodyClass="flush"
              >
                {!detail.courses.length ? (
                  <EmptyState icon="book-open" title="No courses" message="This teacher has no course assigned." />
                ) : (
                  <TableWrap>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Subject</th>
                          <th>Class</th>
                          <th>Department</th>
                          <th className="num">Students</th>
                          <th className="num">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.courses.map((row) => (
                          <tr key={row.id}>
                            <td className="cell-primary">{row.subject_name}</td>
                            <td>{`${row.class_name} ${row.section_name}`}</td>
                            <td>{boardBadge(row.board)}</td>
                            <td className="num">{row.students}</td>
                            <td className="num">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon="trash"
                                onClick={() =>
                                  setConfirm({
                                    title: 'Remove this course?',
                                    message: `${detail.faculty.full_name} will lose access to ${row.subject_name} — ${row.class_name} ${row.section_name}, and to those students unless another assignment covers them.`,
                                    onConfirm: () => removeCourse(row),
                                  })
                                }
                                aria-label="Remove"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Card>

              {/* -------------------------------------- class teacher */}
              <Card
                title="Class teacher of"
                hint="A class teacher sees every subject and record of that class, not only their own."
                actions={
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setDialog('classes')}>
                    Assign class
                  </Button>
                }
                bodyClass="flush"
              >
                {!detail.classesOwned.length ? (
                  <EmptyState
                    icon="grid"
                    title="Not a class teacher"
                    message="This teacher is not the class teacher of any class."
                  />
                ) : (
                  <TableWrap>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Class</th>
                          <th>Department</th>
                          <th>Stream</th>
                          <th className="num">Students</th>
                          <th className="num">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.classesOwned.map((row) => (
                          <tr key={row.class_id}>
                            <td className="cell-primary">{row.class_name}</td>
                            <td>{boardBadge(row.board)}</td>
                            <td>{row.stream || '—'}</td>
                            <td className="num">{row.students}</td>
                            <td className="num">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon="trash"
                                onClick={() =>
                                  setConfirm({
                                    title: 'Remove as class teacher?',
                                    message: `${row.class_name} will have no class teacher until someone else is named, and ${detail.faculty.full_name} will lose the whole-class access it grants.`,
                                    onConfirm: () => removeClass(row),
                                  })
                                }
                                aria-label="Remove"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Card>

              {/* -------------------------------------------- mentees */}
              <Card
                title="Mentees"
                hint="A mentor can view their mentees' attendance, results and fee position."
                actions={
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setDialog('mentees')}>
                    Assign students
                  </Button>
                }
                bodyClass="flush"
              >
                {!detail.mentees.length ? (
                  <EmptyState icon="compass" title="No mentees" message="No student is mentored by this teacher." />
                ) : (
                  <TableWrap>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Class</th>
                          <th>Department</th>
                          <th className="num">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.mentees.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <div className="row-person">
                                <Avatar name={row.full_name} src={row.photo} size="sm" />
                                <div style={{ minWidth: 0 }}>
                                  <div className="cell-primary truncate">{row.full_name}</div>
                                  <div className="cell-sub mono">{row.admission_number}</div>
                                </div>
                              </div>
                            </td>
                            <td>{`${row.class_name || ''} ${row.section_name || ''}`.trim() || '—'}</td>
                            <td>{boardBadge(row.board)}</td>
                            <td className="num">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon="trash"
                                onClick={() =>
                                  setConfirm({
                                    title: 'Remove this mentee?',
                                    message: `${row.full_name} will have no mentor until someone else is assigned.`,
                                    onConfirm: () => removeMentee(row),
                                  })
                                }
                                aria-label="Remove"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      {dialog === 'courses' && (
        <AssignCourses
          faculty={detail.faculty}
          board={board}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog === 'classes' && (
        <AssignClasses
          faculty={detail.faculty}
          classes={dept.filter(lookups.classes)}
          held={detail.classesOwned.map((c) => c.class_id)}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog === 'mentees' && (
        <AssignMentees
          faculty={detail.faculty}
          classes={dept.filter(lookups.classes)}
          sections={dept.filter(lookups.sections)}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel="Remove"
        loading={busy}
        onConfirm={() => confirm?.onConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/* ===================================================================== */
/*  ASSIGN COURSES                                                       */
/* ===================================================================== */

function AssignCourses({ faculty, board, onClose, onDone }) {
  const toast = useToast();
  const [classId, setClassId] = useState('');
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);

  const { data, loading } = useFetch(
    () => api.get(`/assignments/faculty/${faculty.id}/available-courses${qs({ board, class_id: classId })}`),
    [faculty.id, board, classId]
  );

  const key = (row) => `${row.course_id}:${row.section_id}`;
  const toggle = (row) =>
    setPicked((current) =>
      current.some((p) => key(p) === key(row)) ? current.filter((p) => key(p) !== key(row)) : [...current, row]
    );

  const grouped = useMemo(() => {
    const map = new Map();
    for (const row of data || []) {
      const label = `${row.class_name} ${row.section_name}`;
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(row);
    }
    return [...map.entries()];
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.post(`/assignments/faculty/${faculty.id}/courses`, {
        items: picked.map((p) => ({ course_id: p.course_id, section_id: p.section_id })),
      });
      toast.success(
        `${result.assigned} course${result.assigned === 1 ? '' : 's'} assigned`,
        `${faculty.full_name} can now mark attendance and enter marks for them.`
      );
      onDone();
    } catch (e) {
      toast.error('Could not assign the courses', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title="Assign courses"
      subtitle={`to ${faculty.full_name}`}
      footer={
        <>
          <span className="text-sm text-muted">{picked.length} selected</span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!picked.length}>
            Assign {picked.length || ''}
          </Button>
        </>
      }
    >
      <div className="row row-wrap mb-4" style={{ gap: 10 }}>
        <Select
          value={classId}
          onChange={(event) => setClassId(event.target.value)}
          placeholder="All classes"
          options={[...new Map((data || []).map((r) => [r.class_id, r])).values()].map((r) => ({
            value: String(r.class_id),
            label: `${r.class_name} · ${BOARD_LABEL[r.board] || r.board}`,
          }))}
          style={{ maxWidth: 240 }}
        />
      </div>

      {loading ? (
        <Skeleton variant="row" count={6} />
      ) : !grouped.length ? (
        <EmptyState icon="book-open" title="Nothing to assign" message="Every course here is already theirs." />
      ) : (
        <div className="pick-list">
          {grouped.map(([label, rows]) => (
            <div key={label}>
              <div className="pick-head">{label}</div>
              {rows.map((row) => {
                const on = picked.some((p) => key(p) === key(row));
                return (
                  <button
                    key={key(row)}
                    type="button"
                    className={`pick-row${on ? ' on' : ''}`}
                    onClick={() => toggle(row)}
                  >
                    <span className={`tick${on ? ' on' : ''}`}>{on && <Icon name="check" size={12} />}</span>
                    <span className="label">
                      <strong>{row.subject_name}</strong>
                      <span>
                        {row.students} students
                        {row.taken_by ? ` · currently ${row.taken_by}` : ' · unassigned'}
                      </span>
                    </span>
                    {!row.taken_by && (
                      <Badge tone="warning" dot={false}>
                        Unassigned
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ===================================================================== */
/*  ASSIGN A CLASS (as class teacher)                                    */
/* ===================================================================== */

function AssignClasses({ faculty, classes, held, onClose, onDone }) {
  const toast = useToast();
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);

  const available = (classes || []).filter((c) => !held.includes(c.id));

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.post(`/assignments/faculty/${faculty.id}/classes`, { class_ids: picked });
      toast.success(
        `${result.assigned} class${result.assigned === 1 ? '' : 'es'} assigned`,
        result.replaced
          ? `${result.replaced} previously had another class teacher.`
          : `${faculty.full_name} now sees every subject and record of them.`
      );
      onDone();
    } catch (e) {
      toast.error('Could not assign the class', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign a class"
      subtitle={`${faculty.full_name} becomes the class teacher`}
      footer={
        <>
          <span className="text-sm text-muted">{picked.length} selected</span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!picked.length}>
            Assign
          </Button>
        </>
      }
    >
      <div className="callout mb-4">
        <Icon name="info" size={16} />
        <span className="text-sm">
          A class teacher can see every subject, attendance record and result of that class. A class already held by
          someone else will be handed over, and the change is recorded in the audit log.
        </span>
      </div>

      {!available.length ? (
        <EmptyState icon="grid" title="No class available" message="They already hold every class in this department." />
      ) : (
        <div className="pick-list">
          {available.map((klass) => {
            const on = picked.includes(klass.id);
            return (
              <button
                key={klass.id}
                type="button"
                className={`pick-row${on ? ' on' : ''}`}
                onClick={() => setPicked((c) => (on ? c.filter((id) => id !== klass.id) : [...c, klass.id]))}
              >
                <span className={`tick${on ? ' on' : ''}`}>{on && <Icon name="check" size={12} />}</span>
                <span className="label">
                  <strong>{klass.name}</strong>
                  <span>{BOARD_LABEL[klass.board] || klass.board}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* ===================================================================== */
/*  ASSIGN STUDENTS (as mentees)                                         */
/* ===================================================================== */

function AssignMentees({ faculty, classes, sections, onClose, onDone }) {
  const toast = useToast();
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [search, setSearch] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const debounced = useDebounced(search);

  const { data, loading } = useFetch(
    () =>
      api.get(
        `/assignments/students${qs({
          class_id: classId,
          section_id: sectionId,
          search: debounced,
          unassigned: unassignedOnly ? 'true' : undefined,
        })}`
      ),
    [classId, sectionId, debounced, unassignedOnly]
  );

  const rows = data || [];
  const allPicked = rows.length > 0 && rows.every((r) => picked.includes(r.id));

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.post(`/assignments/faculty/${faculty.id}/mentees`, { student_ids: picked });
      toast.success(
        `${result.assigned} student${result.assigned === 1 ? '' : 's'} assigned`,
        result.reassigned ? `${result.reassigned} moved from another mentor.` : 'They can now see their records.'
      );
      onDone();
    } catch (e) {
      toast.error('Could not assign the students', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title="Assign students"
      subtitle={`${faculty.full_name} becomes their mentor`}
      footer={
        <>
          <span className="text-sm text-muted">{picked.length} selected</span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!picked.length}>
            Assign {picked.length || ''}
          </Button>
        </>
      }
    >
      <div className="row row-wrap mb-3" style={{ gap: 8 }}>
        <Select
          value={classId}
          onChange={(event) => {
            setClassId(event.target.value);
            setSectionId('');
          }}
          placeholder="All classes"
          options={(classes || []).map((c) => ({
            value: String(c.id),
            label: `${c.name} · ${BOARD_LABEL[c.board] || c.board}`,
          }))}
          style={{ maxWidth: 200 }}
        />
        <Select
          value={sectionId}
          onChange={(event) => setSectionId(event.target.value)}
          placeholder="All sections"
          options={(sections || [])
            .filter((s) => !classId || String(s.class_id) === String(classId))
            .map((s) => ({ value: String(s.id), label: `${s.class_name || ''} ${s.name}`.trim() }))}
          style={{ maxWidth: 180 }}
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search students"
          style={{ maxWidth: 200 }}
        />
        <Button
          size="sm"
          variant={unassignedOnly ? 'primary' : 'secondary'}
          icon="filter"
          onClick={() => setUnassignedOnly((v) => !v)}
        >
          Without a mentor
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="row-between mb-2">
          <Button
            size="sm"
            variant="ghost"
            icon={allPicked ? 'x-circle' : 'check-circle'}
            onClick={() =>
              setPicked((current) =>
                allPicked
                  ? current.filter((id) => !rows.some((r) => r.id === id))
                  : [...new Set([...current, ...rows.map((r) => r.id)])]
              )
            }
          >
            {allPicked ? 'Clear these' : `Select all ${rows.length}`}
          </Button>
          <span className="text-xs text-muted">{rows.length} shown</span>
        </div>
      )}

      {loading ? (
        <Skeleton variant="row" count={7} />
      ) : !rows.length ? (
        <EmptyState icon="graduation-cap" title="No students" message="No student matches these filters." />
      ) : (
        <div className="pick-list">
          {rows.map((row) => {
            const on = picked.includes(row.id);
            const mine = row.mentor_id === faculty.id;
            return (
              <button
                key={row.id}
                type="button"
                className={`pick-row${on ? ' on' : ''}`}
                onClick={() => setPicked((c) => (on ? c.filter((id) => id !== row.id) : [...c, row.id]))}
                disabled={mine}
              >
                <span className={`tick${on ? ' on' : ''}`}>{on && <Icon name="check" size={12} />}</span>
                <Avatar name={row.full_name} src={row.photo} size="sm" />
                <span className="label">
                  <strong>{row.full_name}</strong>
                  <span>
                    {`${row.class_name || ''} ${row.section_name || ''}`.trim()} · {row.admission_number}
                  </span>
                </span>
                {mine ? (
                  <Badge tone="success" dot={false}>
                    Already theirs
                  </Badge>
                ) : row.mentor_name ? (
                  <span className="text-xs text-muted nowrap">{row.mentor_name}</span>
                ) : (
                  <Badge tone="warning" dot={false}>
                    No mentor
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export default FacultyAssignments;
