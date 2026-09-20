import { useMemo, useRef, useState } from 'react';
import { api, qs, download } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal,
  PageHeader, Select, Skeleton, Tabs, Textarea, Checkbox, fileSize, formatDate, useFetch,
} from '../../components/ui.jsx';

const TYPES = ['NOTES', 'PDF', 'PRESENTATION', 'VIDEO', 'LINK', 'ASSIGNMENT', 'OTHER'];
const TYPE_OPTIONS = TYPES.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
const TABS = [{ key: 'ALL', label: 'All' }, ...TYPES.map((t) => ({ key: t, label: t.replace(/_/g, ' ') }))];

const typeIcon = (t) =>
  ({ VIDEO: 'video', LINK: 'link', PRESENTATION: 'presentation', ASSIGNMENT: 'clipboard', PDF: 'file-text' }[t] ||
  'file-text');

const emptyForm = {
  course_id: '',
  section_id: '',
  title: '',
  material_type: 'NOTES',
  external_url: '',
  due_date: '',
  description: '',
  is_published: true,
};

/**
 * Course materials for a teacher.
 *
 * Upload a file (or share a link) against one of your own courses, choose
 * whether it goes to the whole class or a single section, and publish it so
 * the students of that class can see it. The API refuses any course that is
 * not assigned to you, and only your own uploads can be edited or removed.
 */
export function CourseMaterials() {
  const toast = useToast();
  const fileInput = useRef(null);

  const [type, setType] = useState('ALL');
  const [courseFilter, setCourseFilter] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [nonce, setNonce] = useState(0);

  // The courses (and sections) this teacher is actually assigned to.
  const { data: assignments } = useFetch(() => api.get('/dashboards/teaching'), []);
  const myCourses = useMemo(() => {
    const list = assignments?.assignments || [];
    const seen = new Map();
    for (const a of list) {
      if (!seen.has(a.course_id)) {
        seen.set(a.course_id, { id: a.course_id, name: a.course_name, subject: a.subject_name, sections: [] });
      }
      seen.get(a.course_id).sections.push({ id: a.section_id, label: `${a.class_name} ${a.section_name}` });
    }
    return [...seen.values()];
  }, [assignments]);

  const sectionsForCourse = myCourses.find((c) => String(c.id) === String(form.course_id))?.sections || [];

  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/materials${qs({ material_type: type === 'ALL' ? '' : type, course_id: courseFilter, limit: 100 })}`),
    [type, courseFilter, nonce]
  );

  const set = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const openUpload = () => {
    setForm({ ...emptyForm, course_id: myCourses[0]?.id ?? '' });
    setFile(null);
    setErrors({});
    setUploadOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    const problems = {};
    if (!form.course_id) problems.course_id = 'Choose one of your courses';
    if (!form.title.trim()) problems.title = 'Give the material a title';
    if (!file && !form.external_url.trim()) problems.file = 'Attach a file or provide a link';
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }

    setSaving(true);
    try {
      const body = new FormData();
      body.append('course_id', form.course_id);
      if (form.section_id) body.append('section_id', form.section_id);
      body.append('title', form.title.trim());
      body.append('material_type', form.material_type);
      if (form.external_url.trim()) body.append('external_url', form.external_url.trim());
      if (form.due_date) body.append('due_date', form.due_date);
      if (form.description.trim()) body.append('description', form.description.trim());
      body.append('is_published', form.is_published ? 'true' : 'false');
      if (file) body.append('file', file);

      await api.post('/materials/upload', body);
      toast.success(
        form.is_published ? 'Material published' : 'Material saved as draft',
        form.is_published ? 'Students of this class have been notified.' : 'Publish it when you are ready.'
      );
      setUploadOpen(false);
      setNonce((n) => n + 1);
    } catch (uploadError) {
      setErrors(uploadError.fieldErrors || {});
      toast.fromError(uploadError, 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (material) => {
    setBusyId(material.id);
    try {
      await api.put(`/materials/${material.id}`, { is_published: material.is_published ? 0 : 1 });
      toast.success(material.is_published ? 'Unpublished' : 'Published', material.title);
      setNonce((n) => n + 1);
    } catch (toggleError) {
      toast.fromError(toggleError, 'Could not change visibility');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    setBusyId(deleting.id);
    try {
      await api.delete(`/materials/${deleting.id}`);
      toast.success('Material removed');
      setDeleting(null);
      setNonce((n) => n + 1);
    } catch (deleteError) {
      toast.fromError(deleteError, 'Could not remove this material');
    } finally {
      setBusyId(null);
    }
  };

  const grab = async (material) => {
    try {
      await download(`/materials/${material.id}/download`, material.file_name || material.title);
    } catch (downloadError) {
      toast.fromError(downloadError, 'Download failed');
    }
  };

  return (
    <>
      <PageHeader
        title="Course Materials"
        subtitle="Share notes, PDFs, slides, videos, links and assignments with the classes you teach."
        actions={
          <Button variant="primary" icon="upload" onClick={openUpload} disabled={!myCourses.length}>
            Upload material
          </Button>
        }
      />

      {!myCourses.length && (
        <Card className="mb-4">
          <EmptyState
            icon="book-open"
            title="No courses assigned yet"
            message="Material is uploaded against a course you teach. Ask the Administrator to assign your courses."
          />
        </Card>
      )}

      <Tabs tabs={TABS} active={type} onChange={setType} pill />

      <Card bodyClass="flush" className="mt-4">
        <div className="toolbar">
          <Select
            className="compact"
            value={courseFilter}
            placeholder="All my courses"
            options={myCourses.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(event) => setCourseFilter(event.target.value)}
          />
          <div className="toolbar-spacer" />
          <span className="text-sm text-muted">{data?.length ?? 0} item(s)</span>
          <Button size="sm" variant="ghost" icon="refresh" onClick={refetch} aria-label="Refresh" />
        </div>

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
            title="Nothing shared yet"
            message="Upload notes or an assignment and publish it to your class."
            action={
              myCourses.length ? (
                <Button variant="primary" icon="upload" onClick={openUpload}>
                  Upload material
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div style={{ padding: 16, display: 'grid', gap: 10 }}>
            {data.map((material) => (
              <div className="doc-item" key={material.id}>
                <span className="doc-icon tone-purple">
                  <Icon name={typeIcon(material.material_type)} size={17} />
                </span>
                <div className="doc-meta">
                  <strong>{material.title}</strong>
                  <span>
                    {material.subject_name || material.course_name} · {material.class_name}{' '}
                    {material.section_name || '(all sections)'} · {formatDate(material.created_at)}
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
                <Badge tone={material.is_published ? 'success' : 'neutral'} dot={false}>
                  {material.is_published ? 'Published' : 'Draft'}
                </Badge>

                <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                  {material.file_path && (
                    <Button size="sm" icon="download" onClick={() => grab(material)} aria-label="Download" />
                  )}
                  {material.external_url && (
                    <a
                      href={material.external_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary btn-sm"
                      aria-label="Open link"
                    >
                      <Icon name="external-link" size={14} />
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant={material.is_published ? 'ghost' : 'primary'}
                    loading={busyId === material.id}
                    onClick={() => togglePublish(material)}
                  >
                    <Icon name={material.is_published ? 'eye' : 'send'} size={13} />
                    {material.is_published ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    style={{ color: 'var(--danger-700)' }}
                    onClick={() => setDeleting(material)}
                    aria-label="Delete"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ upload dialog */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        size="wide"
        title="Upload course material"
        subtitle="Published material appears immediately in the student portal."
        footer={
          <>
            <Button onClick={() => setUploadOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon="upload" onClick={submit} loading={saving}>
              {form.is_published ? 'Upload & publish' : 'Save as draft'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Course" required error={errors.course_id}>
              <Select
                value={form.course_id}
                placeholder="Select one of your courses"
                options={myCourses.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(event) => {
                  set('course_id', event.target.value);
                  set('section_id', '');
                }}
              />
            </Field>

            <Field label="Section" hint="Leave blank to share with every section of the class">
              <Select
                value={form.section_id}
                placeholder="All sections I teach"
                options={sectionsForCourse.map((s) => ({ value: s.id, label: s.label }))}
                onChange={(event) => set('section_id', event.target.value)}
                disabled={!form.course_id}
              />
            </Field>

            <Field label="Title" required error={errors.title} className="span-2">
              <Input
                value={form.title}
                placeholder="Chapter 4 — Linear Equations"
                onChange={(event) => set('title', event.target.value)}
              />
            </Field>

            <Field label="Type">
              <Select
                value={form.material_type}
                options={TYPE_OPTIONS}
                onChange={(event) => set('material_type', event.target.value)}
              />
            </Field>

            <Field label="Due date" hint="Assignments only">
              <Input type="date" value={form.due_date} onChange={(event) => set('due_date', event.target.value)} />
            </Field>

            <Field label="File" error={errors.file} className="span-2" hint="PDF, Office document, image, video or audio — up to 50 MB">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setErrors((c) => ({ ...c, file: undefined }));
                  }}
                />
                <Button type="button" size="sm" icon="paperclip" onClick={() => fileInput.current?.click()}>
                  {file ? 'Choose another file' : 'Choose file'}
                </Button>
                {file && (
                  <>
                    <span className="text-sm truncate" style={{ maxWidth: 260 }}>
                      {file.name} · {fileSize(file.size)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      icon="x"
                      onClick={() => {
                        setFile(null);
                        if (fileInput.current) fileInput.current.value = '';
                      }}
                    />
                  </>
                )}
              </div>
            </Field>

            <Field label="Or an external link" className="span-2">
              <Input
                value={form.external_url}
                placeholder="https://..."
                onChange={(event) => set('external_url', event.target.value)}
              />
            </Field>

            <Field label="Description" className="span-2">
              <Textarea
                rows={3}
                value={form.description}
                placeholder="What this covers, and anything students should note."
                onChange={(event) => set('description', event.target.value)}
              />
            </Field>

            <Field className="span-2">
              <Checkbox
                label="Publish to students now"
                checked={form.is_published}
                onChange={(event) => set('is_published', event.target.checked)}
              />
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Remove this material?"
        message={`"${deleting?.title}" will no longer be available to students.`}
        confirmLabel="Remove"
        loading={busyId === deleting?.id}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
}

export default CourseMaterials;
