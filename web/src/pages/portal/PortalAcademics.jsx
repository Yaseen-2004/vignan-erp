import { Fragment, useEffect, useRef, useState } from 'react';
import { api, qs, download } from '../../api/client.js';
import { useActiveStudent } from '../../hooks/useActiveStudent.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ChildSwitcher } from '../parent/ChildSwitcher.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  fileSize,
  formatDate,
  formatDateTime,
  LoadingBlock,
  Modal,
  PageHeader,
  Skeleton,
  TableWrap,
  Tabs,
  useFetch,
  useMediaQuery,
} from '../../components/ui.jsx';

/** What a material can be previewed as, based on its stored file. */
function previewKind(material) {
  if (material.external_url && !material.file_path) return 'link';
  const name = (material.file_name || material.file_path || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp)$/.test(name)) return 'image';
  if (/\.pdf$/.test(name)) return 'pdf';
  if (/\.(mp4|webm)$/.test(name)) return 'video';
  if (/\.(mp3|m4a)$/.test(name)) return 'audio';
  if (/\.(txt|csv)$/.test(name)) return 'text';
  return 'other';
}

/**
 * In-app viewer for a course material.
 *
 * Images, PDFs, video and audio open here so a student never has to leave the
 * portal; anything else offers the download instead. Students can view and
 * download, but never edit or delete — the API refuses those regardless.
 */
function MaterialViewer({ material, onClose, onDownload }) {
  if (!material) return null;
  const kind = previewKind(material);

  const body = () => {
    if (kind === 'image') {
      return (
        <img
          src={material.file_path}
          alt={material.title}
          style={{ width: '100%', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
        />
      );
    }
    if (kind === 'pdf') {
      return (
        <iframe
          title={material.title}
          src={material.file_path}
          style={{ width: '100%', height: '65vh', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
        />
      );
    }
    if (kind === 'video') {
      return (
        <video controls style={{ width: '100%', borderRadius: 'var(--radius)' }} src={material.file_path}>
          Your browser cannot play this video.
        </video>
      );
    }
    if (kind === 'audio') {
      return <audio controls style={{ width: '100%' }} src={material.file_path} />;
    }
    if (kind === 'link') {
      return (
        <EmptyState
          icon="link"
          title="External resource"
          message={material.external_url}
          action={
            <a href={material.external_url} target="_blank" rel="noreferrer" className="btn btn-primary">
              <Icon name="external-link" size={15} /> Open link
            </a>
          }
        />
      );
    }
    return (
      <EmptyState
        icon="file-text"
        title="Preview not available for this file type"
        message={`${material.file_name || 'File'}${material.file_size ? ` · ${fileSize(material.file_size)}` : ''}`}
        action={
          <Button variant="primary" icon="download" onClick={() => onDownload(material)}>
            Download to open
          </Button>
        }
      />
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xwide"
      title={material.title}
      subtitle={`${material.subject_name || material.course_name} · ${material.faculty_name}`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {material.file_path && (
            <Button variant="primary" icon="download" onClick={() => onDownload(material)}>
              Download
            </Button>
          )}
        </>
      }
    >
      {material.description && <p className="text-muted mb-4">{material.description}</p>}
      {body()}
    </Modal>
  );
}

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function NoChild() {
  return (
    <Card>
      <EmptyState
        icon="users"
        title="No student selected"
        message="No student record is linked to this account. Please contact the school office."
      />
    </Card>
  );
}

/* ------------------------------------------------------------- courses */
export function PortalCourses() {
  const { studentId, prefix, hasChildren } = useActiveStudent();
  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/students/${studentId}/profile`),
    [studentId],
    { skip: !studentId }
  );

  if (!hasChildren || !studentId) return <NoChild />;

  return (
    <>
      <PageHeader title="Courses" subtitle="Subjects, assigned faculty and class details for this academic year." />
      {prefix === '/parent' && <ChildSwitcher />}

      {loading || !data ? (
        <LoadingBlock label="Loading courses" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <Card bodyClass="flush">
          {data.courses?.length ? (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Course</th>
                    <th>Code</th>
                    <th>Faculty</th>
                    <th>Class</th>
                    <th>Section</th>
                  </tr>
                </thead>
                <tbody>
                  {data.courses.map((course) => (
                    <tr key={course.id}>
                      <td className="cell-primary">{course.subject_name}</td>
                      <td className="text-muted">{course.name}</td>
                      <td className="mono">{course.code}</td>
                      <td>{course.faculty_name || '—'}</td>
                      <td>{course.class_name}</td>
                      <td>{course.section_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="book-open" title="No courses assigned" />
          )}
        </Card>
      )}
    </>
  );
}

/* ----------------------------------------------------------- materials */
const MATERIAL_TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'NOTES', label: 'Notes' },
  { key: 'PDF', label: 'PDFs' },
  { key: 'PRESENTATION', label: 'Presentations' },
  { key: 'VIDEO', label: 'Videos' },
  { key: 'LINK', label: 'Links' },
  { key: 'ASSIGNMENT', label: 'Assignments' },
];

export function PortalMaterials({ assignmentsOnly = false }) {
  const { studentId, prefix, hasChildren } = useActiveStudent();
  const toast = useToast();
  const [type, setType] = useState(assignmentsOnly ? 'ASSIGNMENT' : 'ALL');
  const [viewing, setViewing] = useState(null);
  const [downloading, setDownloading] = useState(null);

  // Saves with the name the teacher uploaded, not the generated storage name.
  const downloadMaterial = async (material) => {
    setDownloading(material.id);
    try {
      await download(`/materials/${material.id}/download`, material.file_name || material.title);
      toast.success('Download started', material.file_name || material.title);
    } catch (error) {
      toast.fromError(error, 'Could not download this file');
    } finally {
      setDownloading(null);
    }
  };

  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/materials${qs({ material_type: type === 'ALL' ? '' : type, limit: 100 })}`),
    [type]
  );

  if (!hasChildren || !studentId) return <NoChild />;

  return (
    <>
      <PageHeader
        title={assignmentsOnly ? 'Assignments' : 'Course Materials'}
        subtitle={
          assignmentsOnly
            ? 'Work set by teachers, with due dates.'
            : 'Notes, PDFs, presentations, videos and links shared by teachers. These are read-only.'
        }
      />
      {prefix === '/parent' && <ChildSwitcher />}

      {!assignmentsOnly && <Tabs tabs={MATERIAL_TABS} active={type} onChange={setType} pill />}

      <Card bodyClass="flush" className="mt-4">
        {loading ? (
          <div style={{ padding: 16 }}>
            <Skeleton variant="row" count={5} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : !data?.length ? (
          <EmptyState
            icon="files"
            title="No material yet"
            message="Teachers have not shared anything in this category."
          />
        ) : (
          <div style={{ padding: 16, display: 'grid', gap: 10 }}>
            {data.map((material) => (
              <div className="doc-item" key={material.id}>
                <span className={`doc-icon ${materialTone(material.material_type)}`}>
                  <Icon name={materialIcon(material.material_type)} size={17} />
                </span>
                <div className="doc-meta">
                  <strong>{material.title}</strong>
                  <span>
                    {material.subject_name || material.course_name} · {material.faculty_name} ·{' '}
                    {formatDate(material.created_at)}
                    {material.file_size ? ` · ${fileSize(material.file_size)}` : ''}
                  </span>
                  {material.description && <div className="text-xs text-muted mt-2">{material.description}</div>}
                </div>
                {material.due_date && (
                  <Badge tone={new Date(material.due_date) < new Date() ? 'danger' : 'warning'} dot={false}>
                    Due {formatDate(material.due_date)}
                  </Badge>
                )}
                <Badge tone="neutral" dot={false}>
                  {material.material_type}
                </Badge>
                <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                  {(material.file_path || material.external_url) && (
                    <Button size="sm" icon="eye" onClick={() => setViewing(material)}>
                      View
                    </Button>
                  )}
                  {material.file_path && (
                    <Button
                      size="sm"
                      variant="primary"
                      icon="download"
                      loading={downloading === material.id}
                      onClick={() => downloadMaterial(material)}
                    >
                      Download
                    </Button>
                  )}
                  {!material.file_path && material.external_url && (
                    <a href={material.external_url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                      <Icon name="external-link" size={14} /> Visit
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <MaterialViewer material={viewing} onClose={() => setViewing(null)} onDownload={downloadMaterial} />
    </>
  );
}

/* ----------------------------------------------------------- timetable */
/** One period of one day, as a line in the phone list. */
function TimetableLine({ period, slot, isTeacher }) {
  if (!slot) {
    return (
      <div className="tt-line free">
        <span className="p">{period}</span>
        <span className="what"><strong>Free period</strong></span>
      </div>
    );
  }
  const who = isTeacher
    ? `${slot.class_name || ''} ${slot.section_name || ''}`.trim()
    : slot.faculty_name || '';
  return (
    <div className="tt-line">
      <span className="p">{period}</span>
      <span className="what">
        <strong>{slot.subject_name || slot.course_name || '—'}</strong>
        {who && <span>{who}</span>}
        <span className="when">
          {slot.start_time}–{slot.end_time}
          {slot.room ? ` · ${slot.room}` : ''}
        </span>
      </span>
    </div>
  );
}


/**
 * The weekly timetable, for whoever is reading it.
 *
 * A pupil and their parent both look at one section, so each slot answers
 * "what am I in, and with whom". A teacher's grid spans several classes, so the
 * same slot has to answer "where am I meant to be" instead — the class and
 * section matter, and their own name on every cell does not. The API already
 * scopes the rows; this only decides how they read.
 */
export function PortalTimetable() {
  const { role } = useAuth();
  const isTeacher = role === 'TEACHING_STAFF';
  const { studentId, prefix, hasChildren } = useActiveStudent();
  const [openDay, setOpenDay] = useState(null);
  // A week grid is eight periods wide; on a phone that is a sideways scroll
  // through every day to read any of them. One day at a time reads better.
  const narrow = useMediaQuery('(max-width: 767px)');
  const dayStrip = useRef(null);

  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/academics/timetable/grid${prefix === '/parent' && !isTeacher ? `?student_id=${studentId}` : ''}`),
    [studentId, isTeacher]
  );

  // Centre the selected day in the strip. On a Saturday it would otherwise sit
  // past the right edge, and the page would look as though no day were chosen.
  // Only the strip's own scroll is touched, never the page's.
  useEffect(() => {
    const button = dayStrip.current;
    const strip = button?.parentElement;
    if (!button || !strip) return;
    strip.scrollLeft = button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2;
  }, [narrow, openDay, data]);

  // A parent with no child selected has nothing to show; a teacher always does.
  if (!isTeacher && (!hasChildren || !studentId)) return <NoChild />;

  const periods = data?.periods || [];
  const grid = data?.grid || [];
  const days = grid.filter((day) => day.slots.length);

  const today = new Date().getDay() || 7;
  const day = days.find((d) => d.day === openDay) || days.find((d) => d.day === today) || days[0];

  return (
    <>
      <PageHeader
        title={isTeacher ? 'My Timetable' : 'Timetable'}
        subtitle={
          isTeacher
            ? 'Every period you teach this week, across all your classes.'
            : 'Weekly class schedule.'
        }
      />
      {prefix === '/parent' && !isTeacher && <ChildSwitcher />}

      {loading ? (
        <LoadingBlock label="Loading timetable" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.slots?.length ? (
        <Card>
          <EmptyState
            icon="clock"
            title="No timetable published"
            message={
              isTeacher
                ? 'No period has been timetabled to you yet. The office sets this up under Academics → Timetable.'
                : 'The timetable for this section has not been set up yet.'
            }
          />
        </Card>
      ) : (
        <Card bodyClass="tight">
          {narrow ? (
            <>
              <div className="tt-days" role="tablist" aria-label="Day">
                {days.map((entry) => (
                  <button
                    key={entry.day}
                    type="button"
                    role="tab"
                    aria-selected={entry.day === day?.day}
                    className={`tt-day-btn ${entry.day === day?.day ? 'on' : ''}`}
                    ref={entry.day === day?.day ? dayStrip : null}
                    onClick={() => setOpenDay(entry.day)}
                  >
                    {DAYS[entry.day].slice(0, 3)}
                  </button>
                ))}
              </div>
              <div className="tt-list">
                {periods.map((period) => (
                  <TimetableLine
                    key={period}
                    period={period}
                    slot={day?.slots.find((item) => item.period === period)}
                    isTeacher={isTeacher}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="scroll-x">
              <div
                className="timetable-grid"
                style={{ gridTemplateColumns: `90px repeat(${periods.length}, minmax(130px, 1fr))` }}
              >
                <div className="tt-head" />
                {periods.map((period) => (
                  <div className="tt-head" key={`h-${period}`}>
                    Period {period}
                  </div>
                ))}

                {days.map((entry) => (
                  <Fragment key={entry.day}>
                    <div className="tt-head" style={{ textAlign: 'left', alignSelf: 'center' }}>
                      {DAYS[entry.day].slice(0, 3)}
                    </div>
                    {periods.map((period) => {
                      const slot = entry.slots.find((item) => item.period === period);
                      return slot ? (
                        <div className="tt-slot" key={`${entry.day}-${period}`}>
                          <strong>{slot.subject_name || slot.course_name || '—'}</strong>
                          <span>
                            {isTeacher
                              ? `${slot.class_name || ''} ${slot.section_name || ''}`.trim()
                              : slot.faculty_name || ''}
                          </span>
                          <div className="text-xs text-subtle">
                            {slot.start_time}–{slot.end_time}
                            {slot.room ? ` · ${slot.room}` : ''}
                          </div>
                        </div>
                      ) : (
                        <div className="tt-empty" key={`${entry.day}-${period}`} />
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------ calendar */
export function PortalCalendar() {
  const { prefix, studentId, hasChildren } = useActiveStudent();
  const { data, loading, error, refetch } = useFetch(() => api.get('/communication/calendar'), []);

  if (!hasChildren || !studentId) return <NoChild />;

  const items = data?.items || [];
  const grouped = items.reduce((acc, item) => {
    const month = new Date(item.date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    (acc[month] ??= []).push(item);
    return acc;
  }, {});

  const tone = { EXAM: 'tone-red', HOLIDAY: 'tone-green', EVENT: 'tone-navy' };
  const icon = { EXAM: 'clipboard-check', HOLIDAY: 'star', EVENT: 'calendar' };

  return (
    <>
      <PageHeader title="Academic Calendar" subtitle="Classes, examinations, events and holidays." />
      {prefix === '/parent' && <ChildSwitcher />}

      {loading ? (
        <LoadingBlock label="Loading calendar" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !items.length ? (
        <Card>
          <EmptyState icon="calendar" title="Nothing scheduled" message="No events or examinations in this period." />
        </Card>
      ) : (
        <div className="stack">
          {Object.entries(grouped).map(([month, monthItems]) => (
            <Card key={month} title={month} bodyClass="flush">
              <div className="feed">
                {monthItems.map((item) => {
                  const past = new Date(item.date) < new Date(new Date().toDateString());
                  return (
                    <div className="feed-item" key={item.id} style={past ? { opacity: 0.6 } : undefined}>
                      <span className={`feed-icon ${tone[item.type] || 'tone-navy'}`}>
                        <Icon name={icon[item.type] || 'calendar'} size={15} />
                      </span>
                      <div className="feed-body">
                        <strong>{item.title}</strong>
                        {item.description && <p>{item.description}</p>}
                        <span className="feed-time">
                          <Badge tone="neutral" dot={false}>
                            {item.type}
                          </Badge>
                          {item.time ? ` ${item.time}` : ''}
                          {item.venue ? ` · ${item.venue}` : ''}
                        </span>
                      </div>
                      <span className="feed-time">{formatDate(item.date)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

const materialIcon = (type) =>
  ({
    NOTES: 'file-text',
    PDF: 'file-text',
    PRESENTATION: 'presentation',
    VIDEO: 'video',
    LINK: 'link',
    ASSIGNMENT: 'clipboard',
  })[type] || 'files';

const materialTone = (type) =>
  ({
    NOTES: 'tone-navy',
    PDF: 'tone-red',
    PRESENTATION: 'tone-amber',
    VIDEO: 'tone-purple',
    LINK: 'tone-teal',
    ASSIGNMENT: 'tone-gold',
  })[type] || 'tone-navy';
