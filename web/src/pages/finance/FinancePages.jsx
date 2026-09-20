import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useLookups } from '../../hooks/useLookups.js';
import { Icon } from '../../components/Icon.jsx';
import { BarsChart, DonutChart, TrendChart } from '../../components/Charts.jsx';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  formatCurrency,
  formatCurrencyExact,
  formatDate,
  LoadingBlock,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

/* -------------------------------------------------------- pending fees */
export function PendingFees() {
  const { lookups } = useLookups();
  const [classId, setClassId] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/finance/pending${qs({ class_id: classId, overdue: overdueOnly ? 'true' : '' })}`),
    [classId, overdueOnly]
  );

  return (
    <>
      <PageHeader
        title="Pending Fees"
        subtitle="Outstanding balances across the institution, with overdue amounts highlighted."
        actions={
          <Link to="/faculty/financial/collection" className="btn btn-primary">
            <Icon name="credit-card" size={16} /> Collect a fee
          </Link>
        }
      />

      {loading ? (
        <LoadingBlock label="Loading pending fees" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <div className="grid grid-stats mb-5">
            <Stat label="Outstanding records" value={data.totals.count} icon="alert-circle" tone="amber" />
            <Stat label="Total outstanding" value={formatCurrency(data.totals.amount)} icon="wallet" tone="red" />
            <Stat label="Overdue amount" value={formatCurrency(data.totals.overdue)} icon="clock" tone="red" />
          </div>

          <Card bodyClass="flush">
            <div className="toolbar">
              <Select
                className="compact"
                value={classId}
                options={(lookups.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
                placeholder="All classes"
                onChange={(event) => setClassId(event.target.value)}
              />
              <Checkbox label="Overdue only" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />
              <div className="toolbar-spacer" />
              <Button size="sm" variant="ghost" icon="refresh" onClick={refetch} aria-label="Refresh" />
            </div>

            {!data.rows.length ? (
              <EmptyState icon="check-circle" title="Nothing outstanding" message="Every assigned fee has been settled." />
            ) : (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Fee Head</th>
                      <th className="num">Billed</th>
                      <th className="num">Paid</th>
                      <th className="num">Balance</th>
                      <th>Due Date</th>
                      <th>Contact</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div className="cell-primary">
                            {row.first_name} {row.last_name}
                          </div>
                          <div className="cell-sub mono">{row.admission_number}</div>
                        </td>
                        <td>
                          {row.class_name} {row.section_name}
                        </td>
                        <td>{row.fee_name}</td>
                        <td className="num">{formatCurrency(row.total_amount - row.discount_amount)}</td>
                        <td className="num">{formatCurrency(row.paid_amount)}</td>
                        <td className="num">
                          <strong className="text-danger">{formatCurrency(row.balance)}</strong>
                        </td>
                        <td className="nowrap">
                          {formatDate(row.due_date)}
                          {row.is_overdue ? (
                            <Badge tone="danger" dot={false}>
                              Overdue
                            </Badge>
                          ) : null}
                        </td>
                        <td className="text-muted">{row.phone || '—'}</td>
                        <td className="actions">
                          <Link to="/faculty/financial/collection" className="btn btn-secondary btn-sm">
                            Collect
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------- financial analysis */
export function FinancialAnalysis() {
  const { data, loading, error, refetch } = useFetch(() => api.get('/finance/summary'), []);

  if (loading) return <LoadingBlock label="Loading financial analysis" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader title="Financial Analysis" subtitle="Collection, income, expenditure and the resulting position." />

      <div className="grid grid-stats mb-5">
        <Stat label="Collected today" value={formatCurrency(data.collection.today)} icon="credit-card" tone="green" />
        <Stat label="Collected this month" value={formatCurrency(data.collection.month)} icon="calendar" tone="navy" />
        <Stat label="Collected this year" value={formatCurrency(data.collection.year)} icon="trending-up" tone="teal" />
        <Stat
          label="Outstanding"
          value={formatCurrency(data.pending.amount)}
          icon="alert-circle"
          tone="red"
          meta={`${data.pending.count} record(s)`}
        />
        <Stat label="Total income" value={formatCurrency(data.income)} icon="wallet" tone="green" meta="This year" />
        <Stat label="Total expenses" value={formatCurrency(data.expenses)} icon="calculator" tone="purple" meta="This year" />
        <Stat
          label="Net position"
          value={formatCurrency(data.net)}
          icon="activity"
          tone={data.net >= 0 ? 'green' : 'red'}
        />
        <Stat label="Transport running cost" value={formatCurrency(data.transportExpense)} icon="bus" tone="amber" />
      </div>

      <div className="grid grid-main mb-5">
        <Card title="Monthly collection" hint="Last 12 months">
          <TrendChart
            data={data.monthlyTrend}
            xKey="month"
            series={[{ key: 'collected', label: 'Collected', color: '#22c55e' }]}
            formatter={(value) => formatCurrency(value)}
            height={300}
          />
        </Card>
        <Card title="Payment modes" hint="This month">
          <DonutChart
            data={(data.byMode || []).map((row) => ({ name: row.payment_mode, value: row.amount }))}
            formatter={(value) => formatCurrency(value)}
          />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Income vs expenses">
          <BarsChart
            data={[
              { name: 'Income', amount: data.income },
              { name: 'Expenses', amount: data.expenses },
              { name: 'Payroll (month)', amount: data.payrollMonth },
              { name: 'Transport', amount: data.transportExpense },
            ]}
            xKey="name"
            series={[{ key: 'amount', label: 'Amount', color: '#245a9e' }]}
            formatter={(value) => formatCurrency(value)}
          />
        </Card>

        <Card title="Recent transactions" bodyClass="flush">
          {data.recent?.length ? (
            <TableWrap>
              <table className="data" style={{ minWidth: 420 }}>
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Student</th>
                    <th>Date</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((payment) => (
                    <tr key={payment.id}>
                      <td className="mono">{payment.receipt_number || '—'}</td>
                      <td className="cell-primary">
                        {payment.first_name} {payment.last_name}
                      </td>
                      <td className="nowrap">{formatDate(payment.payment_date)}</td>
                      <td className="num fw-700">{formatCurrencyExact(payment.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="receipt" title="No transactions" />
          )}
        </Card>
      </div>
    </>
  );
}

/* -------------------------------------------------- fee receipts list */
export function FeeReceipts() {
  const { data, loading, error, refetch } = useFetch(() => api.get('/finance/receipts'), []);

  return (
    <>
      <PageHeader title="Fee Receipts" subtitle="Every receipt issued, newest first." />

      <Card bodyClass="flush">
        {loading ? (
          <div style={{ padding: 16 }}>
            <Skeleton variant="row" count={6} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : !data?.length ? (
          <EmptyState icon="receipt" title="No receipts yet" message="Receipts appear here after a fee is collected." />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Receipt No</th>
                  <th>Student</th>
                  <th>Date</th>
                  <th>Mode</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((receipt) => (
                  <tr key={receipt.id}>
                    <td className="mono cell-primary">{receipt.receipt_number}</td>
                    <td>
                      <div className="cell-primary">
                        {receipt.first_name} {receipt.last_name}
                      </div>
                      <div className="cell-sub mono">{receipt.admission_number}</div>
                    </td>
                    <td className="nowrap">{formatDate(receipt.payment_date)}</td>
                    <td>
                      <Badge tone="neutral" dot={false}>
                        {receipt.payment_mode}
                      </Badge>
                    </td>
                    <td className="num fw-700">{formatCurrencyExact(receipt.amount)}</td>
                    <td className="actions">
                      <Link to={`/receipts/${receipt.id}`} className="btn btn-secondary btn-sm">
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
    </>
  );
}
