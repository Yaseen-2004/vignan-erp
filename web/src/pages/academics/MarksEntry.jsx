import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

const STATE_TONE = {
  PENDING: 'neutral',
  DRAFT: 'warning',
  SUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
};
const STATE_LABEL = {
  PENDING: 'Not started',
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Returned',
};

/**
 * Marks entry.
 *
 * Choose an examination, then a class and section you teach, then enter the
 * marks for that section's students. Only sheets assigned to you are offered —
 * the API refuses anything else, and approved sheets become read-only.
 */
export function MarksEntry() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [examinationId, setExaminationId] = useState(params.get('examination_id') || '');
  const [openSheet, setOpenSheet] = useState(
    params.get('exam_subject_id')
      ? { exam_subject_id: params.get('exam_subject_id'), section_id: params.get('section_id') || '' }
      : null
  );
  const [entries, setEntries] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Examinations the caller can enter marks against.
  const { data: exams, loading: examsLoading } = useFetch(
    () => api.get('/exams/examinations?limit=50&sort=start_date&order=desc'),
    []
  );

  // Only the classes and sections this teacher is responsible for.
  const { data: plan, loading: planLoading, error: planError, refetch: refetchPlan } = useFetch(
    () => api.get(`/exams/marks/assignments${qs({ examination_id: examinationId })}`),
    [examinationId, nonce],
    { skip: !examinationId }
  );

  const { data: sheet, loading, error, refetch } = useFetch(
    () =>
      api.get(
        `/exams/marks/sheet${qs({
          exam_subject_id: openSheet.exam_subject_id,
          section_id: openSheet.section_id,
        })}`
      ),
    [openSheet?.exam_subject_id, openSheet?.section_id, nonce],
    { skip: !openSheet }
  );

  // Default to the most recent examination that still accepts marks.
  useEffect(() => {
    if (examinationId || !exams?.length) return;
    const usable = exams.find((e) => e.status !== 'DRAFT') || exams[0];
    if (usable) setExaminationId(String(usable.id));
  }, [exams, examinationId]);

  useEffect(() => {
    if (!sheet?.students) return;
    const seeded = {};
    for (const student of sheet.students) {
      seeded[student.student_id] = {
        marks_obtained: student.marks_obtained ?? '',
        is_absent: !!student.is_absent,
        remarks: student.remarks ?? '',
        status: student.status,
      };
    }
    setEntries(seeded);
  }, [sheet]);

  const maxMarks = sheet?.examSubject?.max_marks ?? 100;
  const locked = sheet?.locked;

  const stats = useMemo(() => {
    const values = Object.values(entries);
    const numeric = values
      .filter((e) => !e.is_absent && e.marks_obtained !== '')
      .map((e) => Number(e.marks_obtained));
    const average = numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : 0;
    return {
      total: values.length,
      entered: values.filter((e) => e.is_absent || e.marks_obtained !== '').length,
      absent: values.filter((e) => e.is_absent).length,
      average: Number(average.toFixed(1)),
      highest: numeric.length ? Math.max(...numeric) : 0,
    };
  }, [entries]);

  const setEntry = (studentId, patch) =>
    setEntries((current) => ({ ...current, [studentId]: { ...current[studentId], ...patch } }));

  const openSection = (sheetRow, section) => {
    setOpenSheet({ exam_subject_id: String(sheetRow.exam_subject_id), section_id: String(section.section_id) });
    setParams({
      examination_id: examinationId,
      exam_subject_id: String(sheetRow.exam_subject_id),
      section_id: String(section.section_id),
    });
  };

  const closeSection = () => {
    setOpenSheet(null);
    setEntries({});
    setParams({ examination_id: examinationId });
    setNonce((n) => n + 1);
  };

  const save = async (submit) => {
    setSaving(true);
    try {
      const records = Object.entries(entries)
        .filter(([, entry]) => entry.is_absent || entry.marks_obtained !== '')
        .map(([studentId, entry]) => ({
          student_id: Number(studentId),
          marks_obtained: entry.is_absent ? null : Number(entry.marks_obtained),
          is_absent: entry.is_absent,
          remarks: entry.remarks || null,
        }));

      if (!records.length) {
        toast.warning('Nothing to save', 'Enter at least one mark first.');
        return;
      }

      const result = await api.post('/exams/marks/entry', {
        exam_subject_id: Number(openSheet.exam_subject_id),
        submit,
        records,
      });

      toast.success(
        submit ? 'Marks submitted for approval' : 'Marks saved as draft',
        `${result.data.saved} entr${result.data.saved === 1 ? 'y' : 'ies'} ${
          submit ? 'sent to the Administrator' : 'saved — submit when the sheet is complete'
        }.`
      );
      setConfirmSubmit(false);
      setNonce((n) => n + 1);
    } catch (saveError) {
      toast.fromError(saveError, 'Could not save these marks');
    } finally {
      setSaving(false);
    }
  };

  const examOptions = (exams || []).map((e) => ({ value: e.id, label: `${e.name} (${e.status.replace(/_/g, ' ')})` }));

  /* ------------------------------------------------- the entry sheet */
  if (openSheet) {
    return (
      <>
        <PageHeader
          title="Enter Marks"
          subtitle={
            sheet
              ? `${sheet.examSubject.exam_name} · ${sheet.examSubject.subject_name} · ${
                  sheet.section ? `${sheet.section.class_name} ${sheet.section.name}` : 'All my sections'
                }`
              : 'Loading sheet...'
          }
          actions={
            <>
              <Button icon="arrow-left" onClick={closeSection}>
                All sheets
              </Button>
              {!locked && (
                <>
                  <Button icon="save" onClick={() => save(false)} loading={saving}>
                    Save draft
                  </Button>
                  <Button variant="primary" icon="send" onClick={() => setConfirmSubmit(true)} disabled={saving}>
                    Submit for approval
                  </Button>
                </>
              )}
            </>
          }
        />

        {loading || (!sheet && !error) ? (
          <Card>
            <Skeleton variant="row" count={8} />
          </Card>
        ) : error ? (
          /* A shared or stale link may point at a sheet that is not yours. Say
             so plainly and offer the way back, rather than a bare error panel. */
          <Card>
            <EmptyState
              icon={error.status === 403 ? 'lock' : 'alert-circle'}
              title={error.status === 403 ? 'This sheet is not yours' : 'Could not open this sheet'}
              message={
                error.status === 403
                  ? 'Marks can only be entered for the courses assigned to you. This link points at another teacher’s sheet.'
                  : error.message
              }
              action={
                <div className="row" style={{ gap: 8 }}>
                  <Button variant="primary" icon="arrow-left" onClick={closeSection}>
                    Back to my sheets
                  </Button>
                  {error.status !== 403 && (
                    <Button icon="refresh" onClick={refetch}>
                      Try again
                    </Button>
                  )}
                </div>
              }
            />
          </Card>
        ) : (
          <>
            <div className="grid grid-stats mb-4">
              <Stat label="Students" value={stats.total} icon="users" tone="navy" />
              <Stat
                label="Entered"
                value={`${stats.entered}/${stats.total}`}
                icon="clipboard-check"
                tone={stats.entered === stats.total ? 'green' : 'amber'}
              />
              <Stat label="Absent" value={stats.absent} icon="x-circle" tone="red" />
              <Stat label="Average" value={stats.average} icon="activity" tone="blue" meta={`out of ${maxMarks}`} />
              <Stat label="Highest" value={stats.highest} icon="award" tone="purple" />
            </div>

            {locked && (
              <div className="error-state mb-4" style={{ background: 'var(--success-50)', borderColor: '#bbf7d0', color: 'var(--success-700)' }}>
                <Icon name="check-circle" size={18} />
                <div>
                  <strong>This sheet has been approved</strong>
                  <p className="text-sm">Approved marks are locked. Ask an Administrator if a correction is needed.</p>
                </div>
              </div>
            )}

            <Card bodyClass="flush">
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Roll</th>
                      <th>Student</th>
                      <th style={{ width: 130 }} className="num">
                        Marks (max {maxMarks})
                      </th>
                      <th style={{ width: 100 }}>Absent</th>
                      <th>Remarks</th>
                      <th style={{ width: 120 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.students.map((student) => {
                      const entry = entries[student.student_id] || {};
                      const invalid = !entry.is_absent && entry.marks_obtained !== '' && Number(entry.marks_obtained) > maxMarks;
                      return (
                        <tr key={student.student_id}>
                          <td className="num">{student.roll_number || '—'}</td>
                          <td>
                            <div className="row-person">
                              <Avatar name={`${student.first_name} ${student.last_name || ''}`} size="sm" />
                              <div style={{ minWidth: 0 }}>
                                <div className="cell-primary truncate">
                                  {student.first_name} {student.last_name}
                                </div>
                                <div className="cell-sub mono">{student.admission_number}</div>
                              </div>
                            </div>
                          </td>
                          <td className="num">
                            <Input
                              className="marks-input"
                              type="number"
                              min={0}
                              max={maxMarks}
                              step="0.5"
                              value={entry.marks_obtained ?? ''}
                              disabled={locked || entry.is_absent}
                              error={invalid}
                              onChange={(event) => setEntry(student.student_id, { marks_obtained: event.target.value })}
                            />
                          </td>
                          <td>
                            <Checkbox
                              label=""
                              checked={!!entry.is_absent}
                              disabled={locked}
                              onChange={(event) =>
                                setEntry(student.student_id, {
                                  is_absent: event.target.checked,
                                  marks_obtained: event.target.checked ? '' : entry.marks_obtained,
                                })
                              }
                            />
                          </td>
                          <td>
                            <Input
                              value={entry.remarks ?? ''}
                              placeholder="Optional"
                              disabled={locked}
                              onChange={(event) => setEntry(student.student_id, { remarks: event.target.value })}
                            />
                          </td>
                          <td>
                            <Badge tone={STATE_TONE[entry.status] || 'neutral'} dot={false}>
                              {STATE_LABEL[entry.status] || 'Not entered'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          </>
        )}

        <ConfirmDialog
          open={confirmSubmit}
          title="Submit these marks?"
          message="They go to an Administrator for approval. You will not be able to edit them once approved."
          confirmLabel="Submit"
          variant="primary"
          loading={saving}
          onCancel={() => setConfirmSubmit(false)}
          onConfirm={() => save(true)}
        />
      </>
    );
  }

  /* ------------------------------------------ class & section picker */
  return (
    <>
      <PageHeader
        title="Enter Marks"
        subtitle="Your classes for the selected examination. Open a section to enter its marks."
      />

      <Card className="mb-4">
        <Field label="Examination" className="mb-0">
          <Select
            value={examinationId}
            options={examOptions}
            placeholder={examsLoading ? 'Loading...' : 'Select an examination'}
            onChange={(event) => {
              setExaminationId(event.target.value);
              setParams({ examination_id: event.target.value });
            }}
          />
        </Field>
      </Card>

      {!examinationId ? (
        <Card>
          <EmptyState icon="clipboard-check" title="Choose an examination" message="Pick one above to see your classes." />
        </Card>
      ) : planLoading ? (
        <Card>
          <Skeleton variant="row" count={6} />
        </Card>
      ) : planError ? (
        <ErrorState error={planError} onRetry={refetchPlan} />
      ) : !plan?.classes?.length ? (
        <Card>
          <EmptyState
            icon="book-open"
            title="No sheets for you in this examination"
            message="Marks are entered only for the courses assigned to you. If a subject is missing, ask the Administrator to schedule it or assign the course."
          />
        </Card>
      ) : (
        <div className="stack">
          {plan.classes.map((klass) => (
            <Card
              key={klass.class_id}
              title={klass.class_name}
              hint={`${klass.board === 'CBSE' ? 'CBSE' : 'State Board'} · ${klass.sections.length} section(s)`}
              bodyClass="flush"
            >
              <TableWrap>
                <table className="data" style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Subject</th>
                      <th className="num">Students</th>
                      <th className="num">Entered</th>
                      <th>Status</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {klass.sections.flatMap((section) =>
                      section.sheets.map((row) => (
                        <tr key={`${row.exam_subject_id}-${section.section_id}`}>
                          <td className="cell-primary">
                            {klass.class_name} — {section.section_name}
                          </td>
                          <td>{row.subject_name}</td>
                          <td className="num">{row.students}</td>
                          <td className="num">
                            {row.entered}/{row.students}
                          </td>
                          <td>
                            <Badge tone={STATE_TONE[row.state]} dot={false}>
                              {STATE_LABEL[row.state]}
                            </Badge>
                          </td>
                          <td className="num">
                            <Button
                              size="sm"
                              variant={row.state === 'APPROVED' ? 'secondary' : 'primary'}
                              icon={row.state === 'APPROVED' ? 'eye' : 'edit'}
                              onClick={() => openSection(row, section)}
                            >
                              {row.state === 'APPROVED' ? 'View' : 'Enter marks'}
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default MarksEntry;
