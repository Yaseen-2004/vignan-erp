import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useLookups } from '../../hooks/useLookups.js';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  formatCurrency,
  formatCurrencyExact,
  formatDate,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  TableWrap,
  Textarea,
  useDebounced,
  useFetch,
} from '../../components/ui.jsx';

const MODES = ['CASH', 'UPI', 'ONLINE', 'NEFT', 'CARD', 'CHEQUE', 'DD'].map((v) => ({ value: v, label: v }));

/**
 * Fee collection desk.
 *
 * Two full-width steps: find the student, then work on that student's fee
 * account. Collecting records the payment, updates the balance, posts to the
 * income ledger and issues a numbered receipt in one API transaction.
 */
export function FeeCollection() {
  const { lookups } = useLookups();
  const toast = useToast();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const [selected, setSelected] = useState(null);
  const [payment, setPayment] = useState(null);
  const [form, setForm] = useState({ amount: '', payment_mode: 'CASH', transaction_ref: '', bank_name: '', remarks: '' });
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);

  const debounced = useDebounced(search);

  const { data: students, loading } = useFetch(
    () => api.get(`/students${qs({ search: debounced, class_id: classId, limit: 20, status: 'ACTIVE' })}`),
    [debounced, classId],
    { skip: !!selected }
  );

  const { data: fees, loading: feesLoading, error: feesError, refetch } = useFetch(
    () => api.get(`/finance/student-fees${qs({ student_id: selected.id, limit: 50 })}`),
    [selected?.id, nonce],
    { skip: !selected }
  );

  const { data: receipts } = useFetch(
    () => api.get(`/finance/receipts${qs({ student_id: selected?.id })}`),
    [selected?.id, nonce],
    { skip: !selected }
  );

  const summary = useMemo(() => {
    if (!fees) return { total: 0, paid: 0, balance: 0, pending: 0 };
    return fees.reduce(
      (acc, row) => ({
        total: acc.total + Number(row.total_amount - row.discount_amount),
        paid: acc.paid + Number(row.paid_amount),
        balance: acc.balance + Number(row.balance),
        pending: acc.pending + (Number(row.balance) > 0.01 ? 1 : 0),
      }),
      { total: 0, paid: 0, balance: 0, pending: 0 }
    );
  }, [fees]);

  const openPayment = (row) => {
    setPayment(row);
    setForm({ amount: String(row.balance), payment_mode: 'CASH', transaction_ref: '', bank_name: '', remarks: '' });
  };

  const collect = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.post('/finance/collect', {
        student_fee_id: payment.id,
        amount: Number(form.amount),
        payment_mode: form.payment_mode,
        transaction_ref: form.transaction_ref || null,
        bank_name: form.bank_name || null,
        remarks: form.remarks || null,
      });
      toast.success('Payment collected', `Receipt ${result.data.receipt_number} issued.`);
      setPayment(null);
      setNonce((n) => n + 1);
      navigate(`/receipts/${result.data.receipt_id}`);
    } catch (error) {
      toast.fromError(error, 'Could not collect this payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={selected ? 'Fee Account' : 'Fee Collection'}
        subtitle={
          selected
            ? `${selected.full_name} · ${selected.admission_number}`
            : 'Search for the student whose fee you are collecting.'
        }
        actions={
          selected ? (
            <>
              <Button icon="arrow-left" onClick={() => setSelected(null)}>
                Another student
              </Button>
              <Link to={`/faculty/financial/students/${selected.id}`} className="btn btn-secondary">
                <Icon name="eye" size={15} /> Full profile
              </Link>
            </>
          ) : (
            <Link to="/faculty/financial/pending" className="btn btn-secondary">
              <Icon name="alert-circle" size={16} /> Pending fees
            </Link>
          )
        }
      />

      {!selected ? (
        /* ------------------------------------------ step 1: find them */
        <Card title="Find a student" bodyClass="flush">
          <div className="toolbar">
            <div className="search">
              <Icon name="search" size={15} />
              <Input
                placeholder="Search by name, admission number or phone..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                autoFocus
              />
            </div>
            <Select
              className="compact"
              value={classId}
              options={(lookups.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
              placeholder="All classes"
              onChange={(event) => setClassId(event.target.value)}
            />
          </div>

          {loading ? (
            <div style={{ padding: 16 }}>
              <Skeleton variant="row" count={6} />
            </div>
          ) : !students?.length ? (
            <EmptyState icon="search" title="No students found" message="Adjust your search or class filter." />
          ) : (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th>Roll</th>
                    <th>Contact</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(student)}>
                      <td>
                        <div className="row-person">
                          <Avatar name={student.full_name} src={student.photo} size="sm" />
                          <div style={{ minWidth: 0 }}>
                            <div className="cell-primary truncate">{student.full_name}</div>
                            <div className="cell-sub mono">{student.admission_number}</div>
                          </div>
                        </div>
                      </td>
                      <td className="nowrap">
                        {student.class_name} {student.section_name}
                      </td>
                      <td>{student.roll_number || '—'}</td>
                      <td className="text-muted">{student.phone || '—'}</td>
                      <td className="num">
                        <Button size="sm" variant="primary" icon="credit-card" onClick={() => setSelected(student)}>
                          Open account
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ) : (
        /* -------------------------------- step 2: their fee account */
        <div className="stack">
          <Card>
            <div className="row row-wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
              <Avatar name={selected.full_name} src={selected.photo} size="xl" />
              <div className="flex-1" style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 'var(--text-2xl)' }}>{selected.full_name}</h2>
                <div className="row row-wrap mt-2" style={{ gap: 8 }}>
                  <Badge tone="neutral" dot={false}>{selected.admission_number}</Badge>
                  <Badge tone="neutral" dot={false}>
                    {selected.class_name} {selected.section_name}
                  </Badge>
                  <Badge tone="neutral" dot={false}>Roll {selected.roll_number || '—'}</Badge>
                  {selected.board && (
                    <Badge tone={selected.board === 'CBSE' ? 'purple' : 'info'} dot={false}>
                      {selected.board === 'CBSE' ? 'CBSE' : 'State Board'}
                    </Badge>
                  )}
                  {selected.phone && <span className="text-sm text-muted">{selected.phone}</span>}
                </div>
              </div>
            </div>

            <div className="grid grid-stats mt-5">
              <Stat label="Total billed" value={formatCurrency(summary.total)} icon="receipt" tone="navy" />
              <Stat label="Paid to date" value={formatCurrency(summary.paid)} icon="check-circle" tone="green" />
              <Stat
                label="Outstanding"
                value={formatCurrency(summary.balance)}
                icon="alert-circle"
                tone={summary.balance > 0.01 ? 'red' : 'green'}
                meta={summary.balance > 0.01 ? `${summary.pending} head(s) pending` : 'Fully settled'}
              />
              <Stat label="Fee heads" value={fees?.length ?? 0} icon="layers" tone="blue" />
            </div>
          </Card>

          <Card title="Fee heads" hint="Collect against any head with an outstanding balance" bodyClass="flush">
            {feesLoading || (!fees && !feesError) ? (
              <div style={{ padding: 16 }}>
                <Skeleton variant="row" count={4} />
              </div>
            ) : feesError ? (
              <div style={{ padding: 20 }}>
                <ErrorState error={feesError} onRetry={refetch} />
              </div>
            ) : !fees.length ? (
              <EmptyState icon="wallet" title="No fees assigned" message="Assign a fee structure to this student first." />
            ) : (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Fee Head</th>
                      <th>Category</th>
                      <th className="num">Payable</th>
                      <th className="num">Paid</th>
                      <th className="num">Balance</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fees.map((row) => {
                      const overdue = row.balance > 0.01 && row.due_date && new Date(row.due_date) < new Date();
                      return (
                        <tr key={row.id}>
                          <td className="cell-primary">{row.fee_name}</td>
                          <td className="text-muted">{row.category_name}</td>
                          <td className="num">{formatCurrency(row.total_amount - row.discount_amount)}</td>
                          <td className="num">{formatCurrency(row.paid_amount)}</td>
                          <td className="num">
                            <strong className={row.balance > 0.01 ? 'text-danger' : 'text-success'}>
                              {formatCurrency(row.balance)}
                            </strong>
                          </td>
                          <td className="nowrap">{formatDate(row.due_date)}</td>
                          <td>
                            <Badge status={overdue ? 'OVERDUE' : row.status}>{overdue ? 'OVERDUE' : row.status}</Badge>
                          </td>
                          <td className="num">
                            {row.balance > 0.01 ? (
                              <Button size="sm" variant="primary" icon="credit-card" onClick={() => openPayment(row)}>
                                Collect
                              </Button>
                            ) : (
                              <Badge status="PAID">Paid</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title="Payment history" hint="Receipts already issued to this student" bodyClass="flush">
            {!receipts?.length ? (
              <EmptyState
                icon="receipt"
                title="No payments yet"
                message="Collected payments and their receipts appear here."
              />
            ) : (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Receipt No.</th>
                      <th>Date</th>
                      <th>Mode</th>
                      <th className="num">Amount</th>
                      <th className="num">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r) => (
                      <tr key={r.id}>
                        <td className="mono cell-primary">{r.receipt_number}</td>
                        <td className="nowrap">{formatDate(r.payment_date)}</td>
                        <td>{String(r.payment_mode || '').replace(/_/g, ' ')}</td>
                        <td className="num fw-700">{formatCurrencyExact(r.amount)}</td>
                        <td className="num">
                          <Link to={`/receipts/${r.id}`} className="btn btn-ghost btn-sm">
                            <Icon name="printer" size={13} /> Print
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
      )}

      <Modal
        open={!!payment}
        onClose={() => setPayment(null)}
        title="Collect payment"
        subtitle={payment ? `${payment.fee_name} — ${selected?.full_name}` : ''}
        footer={
          <>
            <Button onClick={() => setPayment(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon="receipt" onClick={collect} loading={saving}>
              Collect &amp; issue receipt
            </Button>
          </>
        }
      >
        {payment && (
          <form onSubmit={collect}>
            <div className="card mb-4" style={{ padding: 14, background: 'var(--navy-50)', borderColor: 'var(--navy-100)' }}>
              <div className="row-between">
                <span className="text-sm text-muted">Outstanding balance</span>
                <strong style={{ fontSize: 'var(--text-xl)' }}>{formatCurrencyExact(payment.balance)}</strong>
              </div>
            </div>

            <div className="form-grid">
              <Field label="Amount" required hint={`Maximum ${formatCurrencyExact(payment.balance)}`}>
                <Input
                  type="number"
                  min="1"
                  max={payment.balance}
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Payment mode" required>
                <Select
                  value={form.payment_mode}
                  options={MODES}
                  onChange={(event) => setForm({ ...form, payment_mode: event.target.value })}
                />
              </Field>
              {form.payment_mode !== 'CASH' && (
                <>
                  <Field label="Transaction reference">
                    <Input
                      value={form.transaction_ref}
                      onChange={(event) => setForm({ ...form, transaction_ref: event.target.value })}
                      placeholder="UTR / cheque number"
                    />
                  </Field>
                  <Field label="Bank">
                    <Input value={form.bank_name} onChange={(event) => setForm({ ...form, bank_name: event.target.value })} />
                  </Field>
                </>
              )}
              <Field label="Remarks" className="span-2">
                <Textarea rows={2} value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} />
              </Field>
            </div>
            <button type="submit" hidden />
          </form>
        )}
      </Modal>
    </>
  );
}

export default FeeCollection;
