import { useRef, useState } from 'react';
import { api, download } from '../../api/client.js';
import { Icon } from '../../components/Icon.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Stat,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

/**
 * Bulk import from a spreadsheet.
 *
 * The page is deliberately a sequence rather than a form: choose what is being
 * imported, take the template, upload, *read what will happen*, and only then
 * commit. The checking step is the point of the page — five hundred pupils
 * arriving with a mistyped class is a great deal harder to undo than to
 * prevent, so nothing is written until the administrator has seen the rows and
 * the identifiers each will be given.
 */
export function DataImport() {
  const toast = useToast();
  const fileInput = useRef(null);

  const { data: entities, loading, error, refetch } = useFetch(() => api.get('/imports'), []);
  const [entityKey, setEntityKey] = useState(null);
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [dragging, setDragging] = useState(false);

  const list = entities || [];
  const entity = list.find((e) => e.key === entityKey) || null;

  /** Changing what is being imported invalidates anything already checked. */
  const chooseEntity = (key) => {
    setEntityKey(key);
    setFile(null);
    setReport(null);
    setSkipInvalid(false);
    if (fileInput.current) fileInput.current.value = '';
  };

  const chooseFile = (chosen) => {
    if (!chosen) return;
    if (!chosen.name.toLowerCase().endsWith('.csv')) {
      toast.error('Choose a .csv file — save your spreadsheet as CSV first.');
      return;
    }
    setFile(chosen);
    setReport(null);
    setSkipInvalid(false);
  };

  const downloadTemplate = async () => {
    try {
      await download(`/imports/${entityKey}/template`, `${entityKey}-template.csv`);
    } catch (e) {
      toast.error(e.message || 'Could not download the template');
    }
  };

  /** Upload for checking, or — when `commit` — to actually write. */
  const send = async (commit) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (commit) {
        form.append('commit', 'true');
        if (skipInvalid) form.append('skip_invalid', 'true');
      }
      // `api.post` sends a FormData body as multipart without a JSON header.
      const result = await api.post(`/imports/${entityKey}`, form);
      setReport(result.data);
      if (commit) {
        toast.success(`${result.data.imported} ${entity.label.toLowerCase()} imported`);
      } else if (result.data.invalid) {
        toast.info(`${result.data.valid} row(s) ready, ${result.data.invalid} need attention`);
      } else {
        toast.success(`All ${result.data.valid} row(s) are ready to import`);
      }
    } catch (e) {
      toast.error(e.message || 'The file could not be read');
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setFile(null);
    setReport(null);
    setSkipInvalid(false);
    if (fileInput.current) fileInput.current.value = '';
  };

  if (loading) return <LoadingBlock label="Loading" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title="Import from a Spreadsheet"
        subtitle="Add many records at once from a CSV file. Nothing is saved until you have seen what will happen."
      />

      {/* ---------------------------------------------- 1. what to import */}
      <Card title="1 · What are you importing?">
        <div className="import-choices">
          {list.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`import-choice ${option.key === entityKey ? 'on' : ''}`}
              onClick={() => chooseEntity(option.key)}
              disabled={!option.permitted}
            >
              <span className="import-choice-head">
                <strong>{option.label}</strong>
                {!option.permitted && <Badge tone="neutral" dot={false}>No permission</Badge>}
              </span>
              <span className="import-choice-note">{option.describes}</span>
              <span className="import-generated">
                <Icon name="key" size={12} />
                Generated for you: {option.generated.join(' · ')}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {entity && (
        <>
          {/* -------------------------------------------- 2. the template */}
          <Card
            title="2 · Start from the template"
            hint="The headings must match. Extra columns are reported, not guessed at."
            actions={
              <Button variant="secondary" icon="download" onClick={downloadTemplate}>
                Download template
              </Button>
            }
            className="mt-4"
          >
            {/* A list rather than a table: twenty-four rows of "Optional / —"
                would push the upload step off the screen for no gain. */}
            <div className="import-columns">
              {entity.columns.map((column) => (
                <div className={`import-column ${column.required ? 'needed' : ''}`} key={column.key}>
                  <span className="name">{column.label}</span>
                  {column.required && <span className="flag">required</span>}
                  {column.hint && <span className="hint">{column.hint}</span>}
                </div>
              ))}
            </div>
          </Card>

          {/* ------------------------------------------------ 3. the file */}
          <Card title="3 · Upload your file" className="mt-4">
            <label
              className={`dropzone ${dragging ? 'over' : ''} ${file ? 'has-file' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                chooseFile(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => chooseFile(e.target.files?.[0])}
                hidden
              />
              <Icon name={file ? 'file-text' : 'upload'} size={26} />
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <span className="text-muted">{(file.size / 1024).toFixed(1)} KB — choose another to replace it</span>
                </>
              ) : (
                <>
                  <strong>Drop a CSV file here, or click to choose one</strong>
                  <span className="text-muted">Saved from Excel or Google Sheets as “CSV”</span>
                </>
              )}
            </label>

            <div className="row row-wrap mt-4" style={{ justifyContent: 'flex-end' }}>
              {file && <Button variant="ghost" onClick={startOver}>Clear</Button>}
              <Button
                variant="primary"
                icon="search"
                disabled={!file || busy}
                loading={busy && !report?.committed}
                onClick={() => send(false)}
              >
                Check the file
              </Button>
            </div>
          </Card>

          {/* ------------------------------------------- 4. what will happen */}
          {report && (
            <Card
              title={report.committed ? '4 · Imported' : '4 · What will happen'}
              hint={report.truncated ? 'The first 200 rows are shown.' : undefined}
              className="mt-4"
            >
              <div className="grid grid-stats mb-4">
                <Stat label="Rows in file" value={report.total} icon="list" tone="navy" />
                <Stat
                  label={report.committed ? 'Imported' : 'Ready to import'}
                  value={report.committed ? report.imported : report.valid}
                  icon="check-circle"
                  tone="success"
                />
                <Stat
                  label={report.committed ? 'Skipped' : 'Need attention'}
                  value={report.invalid}
                  icon="alert-circle"
                  tone={report.invalid ? 'red' : 'navy'}
                />
              </div>

              {report.unknownColumns?.length > 0 && (
                <div className="rule-note mb-4">
                  <Icon name="alert-circle" size={14} />
                  <span>
                    <strong>Not recognised, and ignored:</strong> {report.unknownColumns.join(', ')}.
                    Check the spelling against the template above.
                  </span>
                </div>
              )}

              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Row</th>
                      <th>Record</th>
                      <th>Will be given</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.line} className={row.errors.length ? 'row-bad' : undefined}>
                        <td className="mono text-muted">{row.line}</td>
                        <td className="cell-primary">{row.summary || <span className="text-subtle">—</span>}</td>
                        <td className="mono text-xs">
                          {row.generated
                            ? Object.values(row.generated).join(' · ')
                            : <span className="text-subtle">—</span>}
                        </td>
                        <td>
                          {row.errors.length ? (
                            <span className="import-errors">
                              {row.errors.map((message) => (
                                <Badge key={message} tone="danger" dot={false}>{message}</Badge>
                              ))}
                            </span>
                          ) : (
                            <Badge tone="success" dot={false}>
                              {report.committed ? 'Imported' : 'Ready'}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              {!report.committed && (
                <div className="import-commit mt-4">
                  {report.invalid > 0 && (
                    <Checkbox
                      label={`Import anyway, leaving out the ${report.invalid} row(s) that need attention`}
                      checked={skipInvalid}
                      onChange={(e) => setSkipInvalid(e.target.checked)}
                    />
                  )}
                  <div className="row row-wrap" style={{ justifyContent: 'flex-end' }}>
                    <Button variant="ghost" onClick={startOver}>Start over</Button>
                    <Button
                      variant="primary"
                      icon="check"
                      loading={busy}
                      disabled={busy || !report.valid || (report.invalid > 0 && !skipInvalid)}
                      onClick={() => send(true)}
                    >
                      Import {report.valid} {entity.label.toLowerCase()}
                    </Button>
                  </div>
                  {report.invalid > 0 && !skipInvalid && (
                    <p className="text-sm text-muted" style={{ textAlign: 'right' }}>
                      Correct the rows above and upload again, or tick the box to leave them out.
                    </p>
                  )}
                </div>
              )}

              {report.committed && (
                <div className="rule-note mt-4">
                  <Icon name="check-circle" size={14} />
                  <span>
                    <strong>Done.</strong> {report.imported} {entity.label.toLowerCase()} added.
                    New accounts start with the school’s standard password and must change it at first sign-in.
                  </span>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {!entity && (
        <Card className="mt-4">
          <EmptyState
            icon="upload"
            title="Choose what to import"
            message="Pick a record type above to see the columns it expects and to download a template."
          />
        </Card>
      )}
    </>
  );
}

export default DataImport;
