import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useLookups } from '../../hooks/useLookups.js';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, PageHeader, Select,
  Input, Skeleton, Stat, useFetch,
} from '../../components/ui.jsx';

const STATUSES = [
  { value: 'PRESENT', label: 'Present', className: 'on-present' },
  { value: 'ABSENT', label: 'Absent', className: 'on-absent' },
];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Attendance register.
 *
 * A teacher can only open a section they are assigned to — the API refuses
 * anything else, and this page only offers their own assignments.
 */
export function MarkAttendance() {
  const { user, can } = useAuth();
  const { lookups } = useLookups();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const isTeacher = user.role === 'TEACHING_STAFF';
  const { data: teachingData } = useFetch(() => api.get('/dashboards/teaching'), [], { skip: !isTeacher });

  const [filters, setFilters] = useState({
    section_id: params.get('section_id') || '',
    course_id: params.get('course_id') || '',
    date: params.get('date') || today(),
    period: params.get('period') || '1',
  });
  const [marks, setMarks] = useState({});
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  const assignments = teachingData?.assignments || [];

  // Default a teacher to their first assignment.
  useEffect(() => {
    if (isTeacher && assignments.length && !filters.section_id) {
      setFilters((current) => ({
        ...current,
        section_id: String(assignments[0].section_id),
        course_id: String(assignments[0].course_id),
      }));
    }
  }, [assignments, isTeacher, filters.section_id]);

  const query = qs({
    section_id: filters.section_id,
    course_id: filters.course_id,
    date: filters.date,
    period: filters.period,
  });

  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/attendance/register${query}`),
    [query],
    { skip: !filters.section_id }
  );

  // Seed the local state from what is already recorded; default to Present.
  useEffect(() => {
    if (!data?.students) return;
    const seeded = {};
    for (const student of data.students) seeded[student.id] = student.status || 'PRESENT';
    setMarks(seeded);
  }, [data]);

  const summary = useMemo(() => {
    const counts = { PRESENT: 0, ABSENT: 0 };
    for (const value of Object.values(marks)) counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, [marks]);

  const setAll = (status) => {
    const next = {};
    for (const student of data?.students || []) next[student.id] = status;
    setMarks(next);
  };

  /**
   * Pull the previous hour's register forward.
   * Only students still in this section are copied; anyone the earlier period
   * did not cover keeps whatever is already selected.
   */
  const copyPrevious = async () => {
    setCopying(true);
    try {
      const result = await api.get(
        `/attendance/previous${qs({
          section_id: filters.section_id,
          date: filters.date,
          period: filters.period,
        })}`
      );
      if (!result.data.found) {
        toast.info('Nothing to copy', 'No earlier period has been marked for this class today.');
        return;
      }
      const roster = new Set((data?.students || []).map((s) => s.id));
      const copied = {};
      for (const record of result.data.records) {
        if (roster.has(record.student_id)) copied[record.student_id] = record.status;
      }
      setMarks((current) => ({ ...current, ...copied }));
      toast.success(
        `Copied from period ${result.data.period}`,
        `${Object.keys(copied).length} student(s) carried forward${
          result.data.course_name ? ` from ${result.data.course_name}` : ''
        }. Adjust anyone who has changed.`
      );
    } catch (error) {
      toast.fromError(error, 'Could not copy the previous hour');
    } finally {
      setCopying(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.post('/attendance/mark', {
        section_id: Number(filters.section_id),
        course_id: filters.course_id ? Number(filters.course_id) : null,
        attendance_date: filters.date,
        period: Number(filters.period),
        academic_year_id: lookups.academicYears?.find((y) => y.is_current)?.id ?? null,
        records: Object.entries(marks).map(([studentId, status]) => ({ student_id: Number(studentId), status })),
      });
      toast.success(
        'Attendance saved',
        `${result.data.inserted} new, ${result.data.updated} updated. Parents of absent students were notified.`
      );
      refetch();
    } catch (saveError) {
      toast.fromError(saveError, 'Could not save attendance');
    } finally {
      setSaving(false);
    }
  };

  const sectionOptions = isTeacher
    ? assignments.map((assignment) => ({
        value: String(assignment.section_id),
        label: `${assignment.class_name} ${assignment.section_name} — ${assignment.subject_name}`,
        courseId: String(assignment.course_id),
      }))
    : (lookups.sections || []).map((section) => ({
        value: String(section.id),
        label: `${section.class_name} — ${section.name}`,
      }));

  const updateFilter = (name, value) => {
    const next = { ...filters, [name]: value };
    if (name === 'section_id' && isTeacher) {
      const match = sectionOptions.find((option) => option.value === value);
      next.course_id = match?.courseId || '';
    }
    setFilters(next);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Mark Attendance"
        subtitle={
          isTeacher
            ? 'You can mark attendance only for classes assigned to you.'
            : 'Select a class and date to record attendance.'
        }
        actions={
          data?.students?.length ? (
            <Button variant="primary" icon="save" onClick={save} loading={saving}>
              Save attendance
            </Button>
          ) : null
        }
      />

      <Card className="mb-4">
        <div className="form-grid">
          <Field label="Class / Section" required>
            <Select
              value={filters.section_id}
              options={sectionOptions}
              placeholder="Select a class..."
              onChange={(event) => updateFilter('section_id', event.target.value)}
            />
          </Field>
          {!isTeacher && (
            <Field label="Course" hint="Leave blank for a daily register">
              <Select
                value={filters.course_id}
                options={(lookups.courses || []).map((course) => ({ value: String(course.id), label: course.name }))}
                placeholder="Daily attendance"
                onChange={(event) => updateFilter('course_id', event.target.value)}
              />
            </Field>
          )}
          <Field label="Date" required>
            <Input
              type="date"
              max={today()}
              value={filters.date}
              onChange={(event) => updateFilter('date', event.target.value)}
            />
          </Field>
          <Field label="Period">
            <Select
              value={filters.period}
              options={[0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => ({ value: String(p), label: p === 0 ? 'Full day' : `Period ${p}` }))}
              onChange={(event) => updateFilter('period', event.target.value)}
            />
          </Field>
        </div>
      </Card>

      {!filters.section_id ? (
        <Card>
          <EmptyState
            icon="calendar-check"
            title="Choose a class to begin"
            message="Pick the class and date you want to mark attendance for."
          />
        </Card>
      ) : loading ? (
        <Card>
          <Skeleton variant="row" count={8} />
        </Card>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.students?.length ? (
        <Card>
          <EmptyState icon="users" title="No active students" message="This section has no active students." />
        </Card>
      ) : (
        <>
          <div className="grid grid-stats mb-4">
            <Stat label="Present" value={summary.PRESENT} icon="check-circle" tone="green" />
            <Stat label="Absent" value={summary.ABSENT} icon="x-circle" tone="red" />
            <Stat
              label="Attendance"
              value={`${data.students.length ? Math.round((summary.PRESENT / data.students.length) * 100) : 0}%`}
              icon="percent"
              tone="navy"
              meta={`${data.students.length} students`}
            />
          </div>

          <Card
            title={`${data.section?.class_name} ${data.section?.name} — ${data.students.length} students`}
            hint={data.marked ? 'Attendance already recorded for this session; saving will update it.' : 'Not yet marked'}
            bodyClass="flush"
            actions={
              <div className="row" style={{ gap: 6 }}>
                <Button
                  size="sm"
                  icon="history"
                  loading={copying}
                  onClick={copyPrevious}
                  disabled={Number(filters.period) <= 1}
                  title={
                    Number(filters.period) <= 1
                      ? 'Available from the second period onwards'
                      : 'Carry the previous hour forward'
                  }
                >
                  Copy previous hour
                </Button>
                <Button size="sm" onClick={() => setAll('PRESENT')}>
                  All present
                </Button>
                <Button size="sm" onClick={() => setAll('ABSENT')}>
                  All absent
                </Button>
              </div>
            }
          >
            <div>
              {data.students.map((student) => (
                <div className="attendance-row" key={student.id}>
                  <div className="who">
                    <Avatar name={`${student.first_name} ${student.last_name || ''}`} src={student.photo} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div className="cell-primary truncate">
                        {student.roll_number ? `${student.roll_number}. ` : ''}
                        {student.first_name} {student.last_name}
                      </div>
                      <div className="cell-sub mono">{student.admission_number}</div>
                    </div>
                  </div>
                  <div className="status-group">
                    {STATUSES.map((status) => (
                      <button
                        key={status.value}
                        type="button"
                        className={`status-opt ${marks[student.id] === status.value ? status.className : ''}`}
                        onClick={() => setMarks((current) => ({ ...current, [student.id]: status.value }))}
                      >
                        {status.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="row mt-4" style={{ justifyContent: 'flex-end' }}>
            <Button variant="primary" size="lg" icon="save" onClick={save} loading={saving}>
              Save attendance for {data.students.length} students
            </Button>
          </div>
        </>
      )}
    </>
  );
}

export default MarkAttendance;
