import { useState } from 'react';
import { api, qs } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import {
  Badge, Button, Card, DetailList, LoadingBlock, Modal, PageHeader, Stat,
  formatCurrencyExact, formatDate, useFetch,
} from '../../components/ui.jsx';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** An employee's own payslips (payroll managers see everyone via /payroll). */
export function Payslips() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);

  const { data, meta, loading, error, refetch } = useFetch(
    () => api.get(`/finance/payroll${qs({ page, limit: 20, sort: 'year', order: 'desc' })}`),
    [page]
  );

  const { data: payslip, loading: payslipLoading } = useFetch(
    () => api.get(`/finance/payroll/${viewing.id}/payslip`),
    [viewing?.id],
    { skip: !viewing }
  );

  const latest = data?.[0];

  return (
    <>
      <PageHeader title="My Payslips" subtitle="Your salary history. Only you and payroll staff can see these records." />

      {latest && (
        <div className="grid grid-stats mb-5">
          <Stat
            label="Latest Net Pay"
            value={formatCurrencyExact(latest.net_salary)}
            icon="banknote"
            tone="green"
            meta={`${MONTHS[latest.month]} ${latest.year}`}
          />
          <Stat label="Gross" value={formatCurrencyExact(latest.gross_salary)} icon="wallet" tone="navy" />
          <Stat label="Deductions" value={formatCurrencyExact(latest.total_deductions)} icon="calculator" tone="red" />
          <Stat label="Status" value={latest.status} icon="check-circle" tone={latest.status === 'PAID' ? 'green' : 'amber'} />
        </div>
      )}

      <Card bodyClass="flush">
        <DataTable
          loading={loading}
          error={error}
          onRetry={refetch}
          rows={data}
          meta={meta}
          onPageChange={setPage}
          emptyTitle="No payslips yet"
          emptyMessage="Payslips appear here once payroll has been processed."
          columns={[
            { key: 'payslip_number', label: 'Payslip', render: (row) => <span className="mono">{row.payslip_number}</span> },
            { key: 'period', label: 'Period', render: (row) => `${MONTHS[row.month]} ${row.year}` },
            { key: 'working_days', label: 'Days', numeric: true, render: (row) => `${row.present_days}/${row.working_days}` },
            { key: 'gross_salary', label: 'Gross', numeric: true, render: (row) => formatCurrencyExact(row.gross_salary) },
            { key: 'total_deductions', label: 'Deductions', numeric: true, render: (row) => formatCurrencyExact(row.total_deductions) },
            { key: 'net_salary', label: 'Net Pay', numeric: true, render: (row) => <strong>{formatCurrencyExact(row.net_salary)}</strong> },
            { key: 'payment_date', label: 'Paid On', render: (row) => (row.payment_date ? formatDate(row.payment_date) : '—') },
            { key: 'status', label: 'Status', badge: true, render: (row) => <Badge status={row.status}>{row.status}</Badge> },
          ]}
          mobileColumns={['period', 'net_salary', 'status']}
          rowActions={(row) => (
            <Button size="sm" onClick={() => setViewing(row)}>
              <Icon name="eye" size={13} /> View
            </Button>
          )}
        />
      </Card>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title="Payslip"
        subtitle={viewing ? `${MONTHS[viewing.month]} ${viewing.year} · ${viewing.payslip_number}` : ''}
        size="wide"
        footer={
          <>
            <Button onClick={() => setViewing(null)}>Close</Button>
            <Button variant="primary" icon="printer" onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      >
        {payslipLoading || !payslip ? (
          <LoadingBlock label="Loading payslip" />
        ) : (
          <div className="receipt" style={{ border: 'none', padding: 0 }}>
            <div className="doc-header">
              <h2>{payslip.campus?.name || 'Vignan Educational Institutions'}</h2>
              <p>{payslip.campus?.address}</p>
              <span className="doc-title">
                Payslip — {MONTHS[payslip.payslip.month]} {payslip.payslip.year}
              </span>
            </div>

            <div className="doc-grid">
              <div className="doc-field">
                <div className="k">Employee</div>
                <div className="v">{payslip.payslip.full_name}</div>
              </div>
              <div className="doc-field">
                <div className="k">Employee Code</div>
                <div className="v mono">{payslip.payslip.faculty_code || '—'}</div>
              </div>
              <div className="doc-field">
                <div className="k">Designation</div>
                <div className="v">{payslip.payslip.designation || '—'}</div>
              </div>
              <div className="doc-field">
                <div className="k">Department</div>
                <div className="v">{payslip.payslip.department_name || '—'}</div>
              </div>
              <div className="doc-field">
                <div className="k">Working Days</div>
                <div className="v">
                  {payslip.payslip.present_days} / {payslip.payslip.working_days}
                </div>
              </div>
              <div className="doc-field">
                <div className="k">Loss of Pay</div>
                <div className="v">{payslip.payslip.lop_days || 0} day(s)</div>
              </div>
            </div>

            <div className="grid grid-2 mt-4">
              <Card title="Earnings">
                <DetailList
                  items={[
                    { label: 'Basic salary', value: formatCurrencyExact(payslip.payslip.basic_salary) },
                    { label: 'HRA', value: payslip.structure ? formatCurrencyExact(payslip.structure.hra) : null },
                    { label: 'DA', value: payslip.structure ? formatCurrencyExact(payslip.structure.da) : null },
                    { label: 'Conveyance', value: payslip.structure ? formatCurrencyExact(payslip.structure.conveyance) : null },
                    { label: 'Medical', value: payslip.structure ? formatCurrencyExact(payslip.structure.medical) : null },
                    { label: 'Other allowances', value: payslip.structure ? formatCurrencyExact(payslip.structure.other_allowances) : null },
                    { label: 'Gross salary', value: <strong>{formatCurrencyExact(payslip.payslip.gross_salary)}</strong> },
                  ]}
                />
              </Card>
              <Card title="Deductions">
                <DetailList
                  items={[
                    { label: 'Provident fund', value: payslip.structure ? formatCurrencyExact(payslip.structure.pf_deduction) : null },
                    { label: 'Tax', value: payslip.structure ? formatCurrencyExact(payslip.structure.tax_deduction) : null },
                    { label: 'Other deductions', value: payslip.structure ? formatCurrencyExact(payslip.structure.other_deductions) : null },
                    { label: 'Total deductions', value: <strong>{formatCurrencyExact(payslip.payslip.total_deductions)}</strong> },
                  ]}
                />
              </Card>
            </div>

            <div className="doc-total">
              <div>
                <div className="k text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                  Amount in words
                </div>
                <div className="fw-600">{payslip.amountInWords}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted">Net pay</div>
                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  {formatCurrencyExact(payslip.payslip.net_salary)}
                </div>
              </div>
            </div>

            <p className="text-xs text-muted text-center mt-5">
              This is a computer-generated payslip and does not require a signature.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

export default Payslips;
