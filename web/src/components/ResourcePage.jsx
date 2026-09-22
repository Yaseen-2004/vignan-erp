import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, qs, download } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useDepartment } from '../context/DepartmentContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { DataTable } from './DataTable.jsx';
import { Icon } from './Icon.jsx';
import {
  Button, Card, ConfirmDialog, Field, Input, Modal, PageHeader, Select, Textarea,
  Checkbox, useDebounced, useFetch,
} from './ui.jsx';

/**
 * Generic, permission-aware CRUD screen.
 *
 * A module supplies its endpoint, columns, form fields and filters; this
 * component provides listing, search, filtering, sorting, pagination, create,
 * edit, delete and export. Buttons only appear when the signed-in user holds
 * the matching permission — the API enforces the same rules again.
 */
/**
 * The singular of a list's title, for the buttons that act on one of them.
 *
 * `title.replace(/s$/, '')` gave "Add Classe". English has no rule that gets
 * this right from the plural alone — "Classes" comes from "Class" and loses
 * "es", while "Courses" comes from "Course" and loses only the "s" — so the
 * handful that do not follow the common case are named.
 */
const IRREGULAR = {
  Classes: 'Class',
  Campuses: 'Campus',
  Faculty: 'Faculty',
  'Fee Structures': 'Fee Structure',
};

const singular = (title) => {
  if (IRREGULAR[title]) return IRREGULAR[title];
  if (title.endsWith('ies')) return `${title.slice(0, -3)}y`;
  if (/(ss|sh|ch|x)es$/.test(title)) return title.slice(0, -2);
  if (title.endsWith('s')) return title.slice(0, -1);
  return title;
};

export function ResourcePage({
  title,
  subtitle,
  endpoint,
  module,
  columns,
  fields = [],
  filters = [],
  defaultSort = { column: 'id', order: 'desc' },
  searchPlaceholder = 'Search...',
  canCreate = true,
  canEdit = true,
  canDelete = true,
  readOnly = false,
  createLabel,
  exportKey,
  lookups,
  transformSubmit,
  emptyMessage,
  extraActions,
  rowLink,
  modalSize = '',
  onRowClick,
  headerExtra,
  autoOpenCreate = false,
  /** Narrow this resource to the department chosen in the topbar. */
  departmentScoped = false,
  mobileColumns,
  primaryColumn,
}) {
  const { can } = useAuth();
  const toast = useToast();
  const dept = useDepartment();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState({});
  const [sort, setSort] = useState(defaultSort);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const debouncedSearch = useDebounced(search);

  const departmentParams = departmentScoped ? dept.params : {};

  const query = useMemo(
    () =>
      qs({
        page,
        limit: 25,
        search: debouncedSearch,
        sort: sort.column,
        order: sort.order,
        ...departmentParams,
        ...filterValues,
      }),
    [page, debouncedSearch, sort, filterValues, departmentParams.board]
  );

  // Switching department mid-list would otherwise leave you on a page that no
  // longer exists in the narrowed result.
  useEffect(() => {
    setPage(1);
  }, [departmentParams.board]);

  const { data, meta, loading, error, refetch } = useFetch(() => api.get(`${endpoint}${query}`), [endpoint, query]);

  const allowCreate = canCreate && !readOnly && can(`${module}.create`, `${module}.manage`);
  const allowEdit = canEdit && !readOnly && can(`${module}.edit`, `${module}.manage`);
  const allowDelete = canDelete && !readOnly && can(`${module}.delete`, `${module}.manage`);
  const allowExport = exportKey && can('reports.export');

  const openCreate = () => {
    const initial = {};
    for (const field of fields) {
      if (field.default !== undefined) initial[field.name] = field.default;
    }
    // Creating while a department is selected pre-fills it.
    if (departmentScoped && dept.department && fields.some((f) => f.name === 'board')) {
      initial.board = dept.department;
    }
    setForm(initial);
    setFormErrors({});
    setEditing('new');
  };

  // A `?new=1` deep link (dashboard quick action) opens the create form once.
  const openedRef = useRef(false);
  useEffect(() => {
    if (autoOpenCreate && !openedRef.current && allowCreate) {
      openedRef.current = true;
      openCreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenCreate, allowCreate]);

  const openEdit = (row) => {
    const initial = {};
    for (const field of fields) {
      const value = row[field.name];
      initial[field.name] = value === null || value === undefined ? '' : value;
    }
    setForm(initial);
    setFormErrors({});
    setEditing(row);
  };

  const setValue = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setFormErrors((current) => ({ ...current, [name]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormErrors({});
    try {
      let payload = { ...form };
      for (const field of fields) {
        if (field.type === 'number' && payload[field.name] !== '' && payload[field.name] !== undefined) {
          payload[field.name] = Number(payload[field.name]);
        }
        if (field.type === 'checkbox') payload[field.name] = payload[field.name] ? 1 : 0;
        if (payload[field.name] === '') payload[field.name] = null;
      }
      if (transformSubmit) payload = transformSubmit(payload, editing);

      if (editing === 'new') {
        await api.post(endpoint, payload);
        toast.success(`${title.replace(/s$/, '')} created`);
      } else {
        await api.put(`${endpoint}/${editing.id}`, payload);
        toast.success(`${title.replace(/s$/, '')} updated`);
      }
      setEditing(null);
      refetch();
    } catch (submitError) {
      const fieldErrors = submitError.fieldErrors || {};
      setFormErrors(fieldErrors);
      toast.fromError(submitError, 'Could not save this record');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`${endpoint}/${deleting.id}`);
      toast.success('Record deleted');
      setDeleting(null);
      refetch();
    } catch (deleteError) {
      toast.fromError(deleteError, 'Could not delete this record');
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async (format) => {
    try {
      await download(`/reports/${exportKey}?format=${format}${query.replace('?', '&')}`, `${exportKey}-report.${format}`);
      toast.success(`${format.toUpperCase()} export downloaded`);
    } catch (exportError) {
      toast.fromError(exportError, 'Export failed');
    }
  };

  // Class, section and course pickers only offer the working department.
  const scopedLookups = useMemo(() => {
    if (!departmentScoped || !dept.department) return lookups;
    return {
      ...lookups,
      classes: dept.filter(lookups?.classes),
      sections: dept.filter(lookups?.sections),
      courses: dept.filter(lookups?.courses),
    };
  }, [lookups, departmentScoped, dept.department]);

  const renderField = useCallback(
    (field) => {
      if (field.when && !field.when(form)) return null;
      const value = form[field.name] ?? '';
      const error = formErrors[field.name];
      const common = {
        value,
        error,
        onChange: (event) =>
          setValue(field.name, field.type === 'checkbox' ? event.target.checked : event.target.value),
      };

      let control;
      if (field.type === 'select') {
        const options =
          typeof field.options === 'function' ? field.options(scopedLookups || {}, form) : field.options || [];
        control = <Select {...common} options={options} placeholder={field.placeholder ?? 'Select...'} />;
      } else if (field.type === 'textarea') {
        control = <Textarea {...common} rows={field.rows || 3} placeholder={field.placeholder} />;
      } else if (field.type === 'checkbox') {
        control = (
          <Checkbox
            label={field.checkboxLabel || field.label}
            checked={!!form[field.name]}
            onChange={(event) => setValue(field.name, event.target.checked)}
          />
        );
      } else {
        control = <Input {...common} type={field.type || 'text'} placeholder={field.placeholder} step={field.step} />;
      }

      return (
        <Field
          key={field.name}
          label={field.type === 'checkbox' ? undefined : field.label}
          required={field.required}
          error={error}
          hint={field.hint}
          className={field.full ? 'span-2' : ''}
        >
          {control}
        </Field>
      );
    },
    [form, formErrors, scopedLookups, toast]
  );

  const grouped = useMemo(() => {
    const sections = new Map();
    for (const field of fields) {
      const key = field.section || '';
      if (!sections.has(key)) sections.set(key, []);
      sections.get(key).push(field);
    }
    return [...sections.entries()];
  }, [fields]);

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {extraActions}
            {allowExport && (
              <>
                <Button icon="download" size="sm" onClick={() => exportReport('xlsx')}>
                  Excel
                </Button>
                <Button icon="file-text" size="sm" onClick={() => exportReport('pdf')}>
                  PDF
                </Button>
              </>
            )}
            {allowCreate && (
              <Button variant="primary" icon="plus" onClick={openCreate}>
                {createLabel || `Add ${singular(title)}`}
              </Button>
            )}
          </>
        }
      />

      {headerExtra}

      <Card bodyClass="flush">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={15} />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          {filters.map((filter) => {
            const options =
              typeof filter.options === 'function' ? filter.options(scopedLookups || {}) : filter.options || [];
            return (
              <Select
                key={filter.name}
                className="compact"
                value={filterValues[filter.name] ?? ''}
                options={options}
                placeholder={filter.placeholder || `All ${filter.label}`}
                onChange={(event) => {
                  setFilterValues((current) => ({ ...current, [filter.name]: event.target.value }));
                  setPage(1);
                }}
              />
            );
          })}
          {(Object.values(filterValues).some(Boolean) || search) && (
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              onClick={() => {
                setFilterValues({});
                setSearch('');
                setPage(1);
              }}
            >
              Clear
            </Button>
          )}
          <div className="toolbar-spacer" />
          <Button size="sm" variant="ghost" icon="refresh" onClick={refetch} aria-label="Refresh" />
        </div>

        <DataTable
          columns={columns}
          rows={data}
          loading={loading}
          error={error}
          onRetry={refetch}
          meta={meta}
          onPageChange={setPage}
          sort={sort}
          onSortChange={(next) => {
            setSort(next);
            setPage(1);
          }}
          onRowClick={onRowClick || rowLink}
          mobileColumns={mobileColumns}
          primaryColumn={primaryColumn}
          emptyMessage={emptyMessage}
          emptyAction={
            allowCreate ? (
              <Button variant="primary" icon="plus" onClick={openCreate}>
                {createLabel || `Add ${singular(title)}`}
              </Button>
            ) : undefined
          }
          rowActions={
            allowEdit || allowDelete
              ? (row) => (
                  <>
                    {allowEdit && (
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => openEdit(row)} aria-label="Edit" />
                    )}
                    {allowDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        onClick={() => setDeleting(row)}
                        aria-label="Delete"
                        style={{ color: 'var(--danger-700)' }}
                      />
                    )}
                  </>
                )
              : undefined
          }
        />
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        size={modalSize || (fields.length > 6 ? 'wide' : '')}
        title={editing === 'new' ? createLabel || `Add ${singular(title)}` : `Edit ${singular(title)}`}
        subtitle={editing !== 'new' && editing ? `Record #${editing.id}` : undefined}
        footer={
          <>
            <Button onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} icon="save">
              {editing === 'new' ? 'Create' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit}>
          {grouped.map(([section, sectionFields]) => (
            <div className="form-section" key={section || 'default'}>
              {section && <h4>{section}</h4>}
              <div className="form-grid">{sectionFields.map(renderField)}</div>
            </div>
          ))}
          <button type="submit" hidden />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this record?"
        message="This action cannot be undone. Linked records may prevent deletion."
        confirmLabel="Delete"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}

export default ResourcePage;
