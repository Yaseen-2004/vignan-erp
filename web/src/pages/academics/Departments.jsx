import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDepartment } from '../../context/DepartmentContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  formatCurrency,
  formatNumber,
  Meter,
  PageHeader,
  Skeleton,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

const STYLE = {
  STATE: { tone: 'tone-blue', icon: 'layers', accent: 'var(--info-500)' },
  CBSE: { tone: 'tone-purple', icon: 'globe', accent: 'var(--purple-500)' },
};

/** The operations available once a department is chosen. */
const OPERATIONS = [
  { label: 'Students', path: '/students', icon: 'graduation-cap', permission: 'students.view' },
  { label: 'Admission', path: '/admission', icon: 'user-plus', permission: 'students.create' },
  { label: 'Enrollment', path: '/enrollment', icon: 'file-check', permission: 'enrollments.view' },
  { label: 'Classes', path: '/classes', icon: 'grid', permission: 'academics.view' },
  { label: 'Sections', path: '/sections', icon: 'list', permission: 'academics.view' },
  { label: 'Courses', path: '/courses', icon: 'book-open', permission: 'courses.view' },
  { label: 'Course Assignment', path: '/course-assignments', icon: 'link', permission: 'courses.view' },
  { label: 'Faculty', path: '/faculty', icon: 'briefcase', permission: 'faculty.view' },
  { label: 'Attendance', path: '/attendance', icon: 'calendar-check', permission: 'attendance.view' },
  { label: 'Examinations', path: '/examinations', icon: 'clipboard-check', permission: 'examinations.view' },
  { label: 'Results', path: '/results', icon: 'award', permission: 'results.view' },
  { label: 'Fees', path: '/fees', icon: 'wallet', permission: 'fees.view' },
];

/**
 * The two departments the school runs, side by side.
 *
 * Choosing one sets the working department for the whole session — every list,
 * dashboard and new record narrows to it — and the operations below then act
 * inside that wing.
 */
export function Departments({ basePath = '/administrator' }) {
  const { can } = useAuth();
  const dept = useDepartment();
  const navigate = useNavigate();

  const { data, loading, error, refetch } = useFetch(() => api.get('/academics/departments/overview'), []);

  const operations = OPERATIONS.filter((op) => can(op.permission));

  const enter = (board, path = '/students') => {
    dept.setDepartment(board);
    navigate(`${basePath}${path}`);
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Departments" subtitle="Loading..." />
        <div className="grid grid-2">
          <Skeleton variant="stat" height={280} />
          <Skeleton variant="stat" height={280} />
        </div>
      </>
    );
  }
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title="Departments"
        subtitle="The school runs two departments. Choose one to work inside it, or stay across both."
        actions={
          dept.department ? (
            <Button icon="x" onClick={() => dept.setDepartment('')}>
              Clear selection ({dept.label})
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-2 mb-5">
        {(data || []).map((row) => {
          const style = STYLE[row.board] || STYLE.STATE;
          const selected = dept.department === row.board;
          return (
            <Card
              key={row.board}
              className={selected ? 'department-card selected' : 'department-card'}
              style={selected ? { borderColor: style.accent, boxShadow: 'var(--shadow)' } : undefined}
            >
              <div className="row-between mb-4" style={{ alignItems: 'flex-start' }}>
                <div className="row" style={{ gap: 12, minWidth: 0 }}>
                  <span className={`stat-icon ${style.tone}`} style={{ width: 46, height: 46 }}>
                    <Icon name={style.icon} size={22} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontSize: 'var(--text-xl)' }}>{row.label}</h3>
                    <p className="text-sm text-muted">{row.description}</p>
                  </div>
                </div>
                {selected && <Badge tone="success">Working here</Badge>}
              </div>

              <div className="grid grid-stats" style={{ gap: 10, marginBottom: 16 }}>
                <div>
                  <div className="stat-label">Students</div>
                  <div className="fw-700 text-lg">{formatNumber(row.students)}</div>
                </div>
                <div>
                  <div className="stat-label">Classes</div>
                  <div className="fw-700 text-lg">{row.classes}</div>
                </div>
                <div>
                  <div className="stat-label">Sections</div>
                  <div className="fw-700 text-lg">{row.sections}</div>
                </div>
                <div>
                  <div className="stat-label">Courses</div>
                  <div className="fw-700 text-lg">{row.courses}</div>
                </div>
                <div>
                  <div className="stat-label">Teachers</div>
                  <div className="fw-700 text-lg">{row.teachers}</div>
                </div>
              </div>

              {row.attendancePercent !== null && (
                <div className="mb-3">
                  <Meter label="Attendance (30d)" value={row.attendancePercent} />
                </div>
              )}

              {row.fees && (
                <div className="row-between text-sm mb-4">
                  <span className="text-muted">Fees collected</span>
                  <span>
                    <strong>{formatCurrency(row.fees.collected)}</strong>
                    <span className="text-muted"> of {formatCurrency(row.fees.billed)}</span>
                  </span>
                </div>
              )}

              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant={selected ? 'secondary' : 'primary'} icon="arrow-right" onClick={() => enter(row.board)}>
                  {selected ? 'Open students' : `Work in ${row.label}`}
                </Button>
                {can('students.create') && (
                  <Button icon="user-plus" onClick={() => enter(row.board, '/admission')}>
                    Admit student
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card
        title={dept.department ? `Operations — ${dept.label}` : 'Operations'}
        hint={
          dept.department
            ? 'Everything below is limited to the selected department.'
            : 'Choose a department above to narrow these, or open them across both wings.'
        }
      >
        <div className="quick-actions">
          {operations.map((op) => (
            <button
              key={op.path}
              type="button"
              className="quick-action"
              onClick={() => navigate(`${basePath}${op.path}`)}
            >
              <span className={`qa-icon ${dept.department ? STYLE[dept.department].tone : 'tone-navy'}`}>
                <Icon name={op.icon} size={16} />
              </span>
              <span className="flex-1 truncate">{op.label}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-2 mt-5">
        {(data || []).map((row) => (
          <Card key={row.board} title={`${row.label} — classes`} bodyClass="flush">
            <TableWrap>
              <table className="data" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th className="num">Students</th>
                  </tr>
                </thead>
                <tbody>
                  {row.classList.map((klass) => (
                    <tr key={klass.id}>
                      <td className="cell-primary">{klass.name}</td>
                      <td className="num">{klass.students}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        ))}
      </div>
    </>
  );
}

export default Departments;
