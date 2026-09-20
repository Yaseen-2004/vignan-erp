import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Icon } from '../../components/Icon.jsx';
import {
  Button,
  ErrorState,
  formatDate,
  LoadingBlock,
  PageHeader,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

const ordinal = (n) => {
  if (!n) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * Report card.
 *
 * Laid out as school stationery rather than a screen: a serif masthead, ruled
 * particulars, a marks ledger and a signed declaration, so the printed sheet
 * and the on-screen sheet are the same document.
 */
export function ReportCard() {
  const { examinationId, studentId } = useParams();
  const navigate = useNavigate();

  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/exams/report-card/${examinationId}/${studentId}`),
    [examinationId, studentId]
  );

  if (loading) return <LoadingBlock label="Preparing report card" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { result, subjects, campus, gradeScale } = data;
  const passed = result.result_status === 'PASS';
  const fullName = `${result.first_name} ${result.last_name || ''}`.trim();
  const passedCount = subjects.filter((s) => !s.is_absent && s.marks_obtained >= s.pass_marks).length;

  return (
    <>
      <PageHeader
        title="Report Card"
        subtitle={`${result.exam_name} · ${fullName}`}
        actions={
          <>
            <Button icon="arrow-left" onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button variant="primary" icon="printer" onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />

      <div className="sheet-wrap">
        <article className="sheet">
          <div className="sheet-watermark" aria-hidden="true">
            <span>VIGNAN</span>
          </div>

          {/* -------------------------------------------- masthead */}
          <header className="sheet-head">
            <span className="sheet-seal">V</span>
            <div className="sheet-org">
              <h1>{campus?.name || 'Vignan Educational Institutions'}</h1>
              <div className="addr">
                {[campus?.address, campus?.city, campus?.state].filter(Boolean).join(', ')}
                {campus?.pincode ? ` — ${campus.pincode}` : ''}
                <br />
                {[campus?.phone, campus?.email].filter(Boolean).join('   ·   ')}
              </div>
              <div className="affil">
                {result.board === 'CBSE' ? 'CBSE DEPARTMENT' : 'KARNATAKA STATE BOARD DEPARTMENT'}
              </div>
            </div>
            <span className="sheet-seal" style={{ visibility: 'hidden' }} aria-hidden="true">
              V
            </span>
          </header>
          <hr className="sheet-rule" />

          <div className="sheet-title">
            <h2>Report Card</h2>
            <p>
              {result.exam_name}
              {result.academic_year_name ? `   ·   Academic Year ${result.academic_year_name}` : ''}
            </p>
          </div>

          {/* ----------------------------------------- particulars */}
          <div className="particulars">
            <div className="pfield">
              <span className="k">Name of Student</span>
              <span className="v">{fullName}</span>
            </div>
            <div className="pfield">
              <span className="k">Admission No.</span>
              <span className="v mono">{result.admission_number}</span>
            </div>

            <div className="pfield">
              <span className="k">Class &amp; Section</span>
              <span className="v">
                {result.class_name} — {result.section_name}
              </span>
            </div>
            <div className="pfield">
              <span className="k">Roll No.</span>
              <span className="v">{result.roll_number || '—'}</span>
            </div>

            <div className="pfield">
              <span className="k">Department</span>
              <span className="v">{result.board === 'CBSE' ? 'CBSE' : 'State Board'}</span>
            </div>
            <div className="pfield">
              <span className="k">Date of Birth</span>
              <span className="v">{formatDate(result.date_of_birth)}</span>
            </div>

            <div className="pfield">
              <span className="k">Examination</span>
              <span className="v">{result.exam_name}</span>
            </div>
            <div className="pfield">
              <span className="k">Held On</span>
              <span className="v">
                {formatDate(result.start_date)}
                {result.end_date ? ` to ${formatDate(result.end_date)}` : ''}
              </span>
            </div>
          </div>

          {/* ----------------------------------------- marks ledger */}
          <div className="sheet-section-label">Statement of Marks</div>
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr>
                  <th className="sn">#</th>
                  <th>Subject</th>
                  <th className="num">Max. Marks</th>
                  <th className="num">Min. Pass</th>
                  <th className="num">Marks Obtained</th>
                  <th className="num">Percentage</th>
                  <th className="ctr">Grade</th>
                  <th className="ctr">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((subject, index) => {
                  const percent = subject.max_marks
                    ? Math.round(((subject.marks_obtained || 0) / subject.max_marks) * 100)
                    : 0;
                  const failed = subject.is_absent || subject.marks_obtained < subject.pass_marks;
                  return (
                    <tr key={index}>
                      <td className="sn">{index + 1}</td>
                      <td style={{ fontWeight: 600 }}>{subject.subject_name}</td>
                      <td className="num">{subject.max_marks}</td>
                      <td className="num">{subject.pass_marks}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {subject.is_absent ? 'AB' : subject.marks_obtained}
                      </td>
                      <td className="num">{subject.is_absent ? '—' : `${percent}%`}</td>
                      <td className="ctr" style={{ fontWeight: 700 }}>
                        {subject.grade || '—'}
                      </td>
                      <td className="ctr" style={{ color: failed ? '#a51d1d' : 'var(--doc-muted)' }}>
                        {subject.is_absent ? 'Absent' : failed ? 'Below pass' : 'Pass'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>Total</td>
                  <td className="num">{result.total_marks}</td>
                  <td />
                  <td className="num">{result.obtained_marks}</td>
                  <td className="num">{result.percentage}%</td>
                  <td className="ctr">{result.grade || '—'}</td>
                  <td className="ctr">
                    {passedCount}/{subjects.length}
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>

          {/* --------------------------------------------- summary */}
          <div className="result-grid">
            <div className="result-cell">
              <div className="k">Percentage</div>
              <div className="v">{result.percentage}%</div>
            </div>
            <div className="result-cell">
              <div className="k">Overall Grade</div>
              <div className="v">{result.grade || '—'}</div>
            </div>
            <div className="result-cell">
              <div className="k">Rank in Class</div>
              <div className="v">{ordinal(result.rank_in_class)}</div>
            </div>
            <div className="result-cell">
              <div className="k">Attendance</div>
              <div className="v">{result.attendance_percent != null ? `${result.attendance_percent}%` : '—'}</div>
            </div>
            <div className="result-cell">
              <div className="k">Pass Mark</div>
              <div className="v">35%</div>
            </div>
            <div className="result-cell">
              <div className="k">Subjects Cleared</div>
              <div className="v">
                {passedCount}/{subjects.length}
              </div>
            </div>
          </div>

          {/* ----------------------------------------- declaration */}
          <div className="declaration">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="sheet-section-label" style={{ margin: '0 0 3px' }}>
                Remarks of the Class Teacher
              </div>
              <div style={{ fontWeight: 600 }}>
                {result.remarks ||
                  (passed
                    ? 'Has shown consistent effort through the term and is promoted to the next level of study.'
                    : 'Has not reached the minimum aggregate required and must reappear for this examination.')}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="sheet-section-label" style={{ margin: 0 }}>
                Result
              </div>
              <div className={`verdict ${passed ? 'pass' : 'fail'}`}>{result.result_status}</div>
            </div>
          </div>

          {/* ---------------------------------------- grade legend */}
          {gradeScale?.length > 0 && (
            <div className="legend">
              <div className="sheet-section-label">Grading Scale</div>
              <TableWrap>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th className="ctr">Grade</th>
                      {gradeScale.map((grade) => (
                        <th key={grade.code} className="ctr">
                          {grade.code}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="ctr" style={{ fontWeight: 600 }}>
                        Percentage
                      </td>
                      {gradeScale.map((grade) => (
                        <td key={grade.code} className="ctr">
                          {grade.min_percent}–{grade.max_percent}
                        </td>
                      ))}
                    </tr>
                    {gradeScale.some((g) => g.grade_point != null) && (
                      <tr>
                        <td className="ctr" style={{ fontWeight: 600 }}>
                          Grade Point
                        </td>
                        {gradeScale.map((grade) => (
                          <td key={grade.code} className="ctr">
                            {grade.grade_point ?? '—'}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          )}

          <div className="sign-block">
            <div>Class Teacher</div>
            <div>Examination In-charge</div>
            <div>Parent / Guardian</div>
            <div>Principal</div>
          </div>

          <footer className="sheet-foot">
            <span>
              <Icon name="shield-check" size={10} /> Generated from the Vignan ERP. Valid without signature when
              verified against the school record.
            </span>
            <span>
              Issued {formatDate(result.published_at || new Date().toISOString())} · Ref{' '}
              {result.admission_number}/{examinationId}
            </span>
          </footer>
        </article>
      </div>
    </>
  );
}

export default ReportCard;
