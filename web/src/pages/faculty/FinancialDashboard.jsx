import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { BarsChart, DonutChart, TrendChart } from '../../components/Charts.jsx';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  formatCurrency,
  formatDate,
  formatNumber,
  PageHeader,
  Stat,
  StatSkeleton,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

const QUICK_ACTIONS = [
  { label: 'Collect Fee', to: '/faculty/financial/collection', icon: 'credit-card', tone: 'tone-green' },
  { label: 'Generate Receipt', to: '/faculty/financial/receipts', icon: 'receipt', tone: 'tone-navy' },
  { label: 'Add Expense', to: '/faculty/financial/expenses?new=1', icon: 'calculator', tone: 'tone-red' },
  { label: 'Financial Report', to: '/faculty/financial/reports', icon: 'bar-chart', tone: 'tone-purple' },
];

export function FinancialDashboard() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useFetch(() => api.get('/dashboards/financial'), []);

  if (loading) {
    return (
      <>
        <PageHeader title="Finance Dashboard" subtitle="Loading collection data..." />
        <StatSkeleton count={8} />
      </>
    );
  }
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { collection, pending, income, expenses, net, payroll, transportExpenses, recentTransactions, monthlyTrend, expenseByCategory } = data;

  return (
    <>
      <PageHeader
        title={`Finance Desk — ${user.fullName.split(' ')[0]}`}
        subtitle="Fee collection, accounts, payroll and transport finance."
      />

      <div className="grid grid-stats mb-5">
        <Stat label="Today's Collection" value={formatCurrency(collection.today)} icon="credit-card" tone="green" meta={`${collection.transactionsToday} transaction(s)`} />
        <Stat label="Monthly Collection" value={formatCurrency(collection.month)} icon="calendar" tone="navy" meta="Current month" />
        <Stat label="Pending Fees" value={formatCurrency(pending.amount)} icon="alert-circle" tone="red" meta={`${formatNumber(pending.count)} record(s) outstanding`} />
        <Stat label="Overdue Amount" value={formatCurrency(pending.overdue)} icon="clock" tone="amber" meta="Past the due date" />
        <Stat label="Total Income" value={formatCurrency(income)} icon="trending-up" tone="teal" meta="This year" />
        <Stat label="Total Expenses" value={formatCurrency(expenses)} icon="calculator" tone="purple" meta="Approved, this year" />
        <Stat label="Net Position" value={formatCurrency(net)} icon="wallet" tone={net >= 0 ? 'green' : 'red'} meta="Income less expenses" />
        <Stat label="Payroll (month)" value={formatCurrency(payroll?.amount || 0)} icon="banknote" tone="gold" meta={`${payroll?.paid || 0} of ${payroll?.payslips || 0} paid`} />
      </div>

      <Card title="Quick actions" className="mb-5">
        <div className="quick-actions">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.label} to={action.to} className="quick-action">
              <span className={`qa-icon ${action.tone}`}>
                <Icon name={action.icon} size={16} />
              </span>
              <span className="flex-1 truncate">{action.label}</span>
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-main mb-5">
        <Card title="Collection trend" hint="Last 12 months">
          <TrendChart
            data={monthlyTrend}
            xKey="month"
            series={[{ key: 'collected', label: 'Collected', color: '#22c55e' }]}
            formatter={(value) => formatCurrency(value)}
            height={280}
          />
        </Card>

        <div className="stack">
          <Card title="Transport expenses" hint="This year">
            <div className="stack-sm">
              <div className="row-between">
                <span className="text-muted text-sm">
                  <Icon name="activity" size={14} /> Fuel
                </span>
                <strong>{formatCurrency(transportExpenses.fuel)}</strong>
              </div>
              <div className="row-between">
                <span className="text-muted text-sm">
                  <Icon name="truck" size={14} /> Maintenance
                </span>
                <strong>{formatCurrency(transportExpenses.maintenance)}</strong>
              </div>
              <div className="row-between" style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <span className="fw-600">Total</span>
                <strong className="text-lg">{formatCurrency(transportExpenses.total)}</strong>
              </div>
              <Link to="/faculty/financial/transport" className="btn btn-secondary btn-sm btn-block mt-3">
                View transport records
              </Link>
            </div>
          </Card>

          <Card title="Expenses by category">
            <DonutChart
              data={expenseByCategory.map((row) => ({ name: row.category, value: row.amount }))}
              formatter={(value) => formatCurrency(value)}
              height={220}
            />
          </Card>
        </div>
      </div>

      <Card
        title="Recent transactions"
        bodyClass="flush"
        actions={<Link to="/faculty/financial/payments" className="btn btn-ghost btn-sm">All payments</Link>}
      >
        {recentTransactions.length ? (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Date</th>
                  <th>Mode</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((payment) => (
                  <tr key={payment.id}>
                    <td className="mono">{payment.receipt_number || '—'}</td>
                    <td className="cell-primary">
                      {payment.first_name} {payment.last_name}
                      <div className="cell-sub">{payment.admission_number}</div>
                    </td>
                    <td>{payment.class_name || '—'}</td>
                    <td className="nowrap">{formatDate(payment.payment_date)}</td>
                    <td>
                      <Badge tone="neutral" dot={false}>{payment.payment_mode}</Badge>
                    </td>
                    <td className="num fw-700">{formatCurrency(payment.amount)}</td>
                    <td className="actions">
                      {payment.receipt_id && (
                        <Link to={`/receipts/${payment.receipt_id}`} className="btn btn-ghost btn-sm">
                          <Icon name="printer" size={14} />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState icon="receipt" title="No transactions yet" message="Collected payments will appear here." />
        )}
      </Card>
    </>
  );
}

export default FinancialDashboard;
