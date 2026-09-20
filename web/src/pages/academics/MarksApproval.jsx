import { useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  formatDateTime,
  LoadingBlock,
  Modal,
  PageHeader,
  Skeleton,
  Stat,
  TableWrap,
  Textarea,
  useFetch,
} from '../../components/ui.jsx';

/**
 * Marks approval queue for administrators.
 *
 * Teachers submit a batch per subject paper; an administrator reviews the
 * entries and either approves them (freezing them and making them eligible
 * for result generation) or returns them for correction.
 */
export function MarksApproval() {
  const toast = useToast();
  const [reviewing, setReviewing] = useState(null);
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const { data: queue, loading, error, refetch } = useFetch(() => api.get('/exams/marks/pending'), [nonce]);
  const { data: sheet, loading: sheetLoading } = useFetch(
    () => api.get(`/exams/marks/sheet?exam_subject_id=${reviewing.exam_subject_id}`),
    [reviewing?.exam_subject_id],
    { skip: !reviewing }
  );

  const review = async (nextDecision) => {
    setBusy(true);
    try {
      const result = await api.post('/exams/marks/review', {
        exam_subject_id: reviewing.exam_subject_id,
        decision: nextDecision,
        reason: nextDecision === 'REJECTED' ? reason : undefined,
      });
      toast.success(
        nextDecision === 'APPROVED' ? 'Marks approved' : 'Marks returned to the teacher',
        `${result.data.affected} entries updated. The teacher has been notified.`
      );
      setReviewing(null);
      setDecision(null);
      setReason('');
      setNonce((n) => n + 1);
    } catch (reviewError) {
      toast.fromError(reviewError, 'Could not complete the review');
    } finally {
      setBusy(false);
    }
  };

  const totalEntries = (queue || []).reduce((sum, batch) => sum + batch.entries, 0);

  return (
    <>
      <PageHeader
        title="Marks Approval"
        subtitle="Review the marks teachers have submitted, then approve or return them."
        actions={<Button icon="refresh" onClick={refetch}>Refresh</Button>}
      />

      <div className="grid grid-stats mb-5">
        <Stat label="Batches awaiting review" value={queue?.length ?? 0} icon="clipboard-check" tone={queue?.length ? 'amber' : 'green'} />
        <Stat label="Mark entries" value={totalEntries} icon="hash" tone="navy" />
        <Stat
          label="Oldest submission"
          value={queue?.length ? formatDateTime(queue[0].submitted_at).split(',')[0] : '—'}
          icon="clock"
          tone="blue"
        />
      </div>

      <Card title="Approval queue" bodyClass="flush">
        {loading ? (
          <div style={{ padding: 16 }}>
            <Skeleton variant="row" count={5} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : !queue?.length ? (
          <EmptyState
            icon="check-circle"
            title="Nothing awaiting approval"
            message="Every submitted batch of marks has been reviewed."
          />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Examination</th>
                  <th>Subject</th>
                  <th>Class</th>
                  <th>Submitted By</th>
                  <th className="num">Entries</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.map((batch) => (
                  <tr key={batch.exam_subject_id}>
                    <td className="cell-primary">{batch.exam_name}</td>
                    <td>
                      <div className="cell-primary">{batch.subject_name}</div>
                      <div className="cell-sub">{batch.course_name}</div>
                    </td>
                    <td>{batch.class_name || '—'}</td>
                    <td>{batch.entered_by_name || '—'}</td>
                    <td className="num">
                      <Badge tone="warning" dot={false}>
                        {batch.entries}
                      </Badge>
                    </td>
                    <td className="nowrap text-muted">{formatDateTime(batch.submitted_at)}</td>
                    <td className="actions">
                      <Button size="sm" variant="primary" onClick={() => setReviewing(batch)}>
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={!!reviewing}
        onClose={() => {
          setReviewing(null);
          setDecision(null);
        }}
        size="wide"
        title={reviewing ? `${reviewing.subject_name} — ${reviewing.exam_name}` : ''}
        subtitle={reviewing ? `${reviewing.entries} entries submitted by ${reviewing.entered_by_name || 'a teacher'}` : ''}
        footer={
          <>
            <Button
              onClick={() => {
                setReviewing(null);
                setDecision(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="danger" icon="x-circle" onClick={() => setDecision('REJECTED')} disabled={busy}>
              Return for correction
            </Button>
            <Button variant="success" icon="check-circle" onClick={() => review('APPROVED')} loading={busy && decision !== 'REJECTED'}>
              Approve marks
            </Button>
          </>
        }
      >
        {sheetLoading ? (
          <LoadingBlock label="Loading submitted marks" />
        ) : sheet ? (
          <>
            {decision === 'REJECTED' && (
              <div className="card mb-4" style={{ padding: 14, background: 'var(--danger-50)', borderColor: '#fecaca' }}>
                <Field label="Reason for returning these marks" required>
                  <Textarea
                    rows={2}
                    value={reason}
                    placeholder="Explain what the teacher needs to correct"
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <Button size="sm" onClick={() => setDecision(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="danger" loading={busy} onClick={() => review('REJECTED')}>
                    Confirm return
                  </Button>
                </div>
              </div>
            )}

            <div className="row row-wrap mb-4" style={{ gap: 20 }}>
              <div>
                <div className="stat-label">Maximum marks</div>
                <strong>{sheet.examSubject.max_marks}</strong>
              </div>
              <div>
                <div className="stat-label">Pass marks</div>
                <strong>{sheet.examSubject.pass_marks}</strong>
              </div>
              <div>
                <div className="stat-label">Students</div>
                <strong>{sheet.students.length}</strong>
              </div>
            </div>

            <TableWrap>
              <table className="data" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Roll</th>
                    <th>Student</th>
                    <th className="num">Marks</th>
                    <th>Grade</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.students.map((student) => (
                    <tr key={student.student_id}>
                      <td className="mono">{student.roll_number || '—'}</td>
                      <td className="cell-primary">
                        {student.first_name} {student.last_name}
                      </td>
                      <td className="num fw-700">
                        {student.is_absent ? (
                          <Badge tone="danger" dot={false}>
                            Absent
                          </Badge>
                        ) : (
                          `${student.marks_obtained ?? '—'} / ${sheet.examSubject.max_marks}`
                        )}
                      </td>
                      <td>{student.grade ? <Badge tone="info" dot={false}>{student.grade}</Badge> : '—'}</td>
                      <td>{student.status ? <Badge status={student.status}>{student.status}</Badge> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        ) : null}
      </Modal>
    </>
  );
}

export default MarksApproval;
