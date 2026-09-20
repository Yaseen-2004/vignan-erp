import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Icon } from '../../components/Icon.jsx';
import {
  Button,
  ErrorState,
  formatCurrencyExact,
  formatDate,
  formatDateTime,
  LoadingBlock,
  PageHeader,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

/**
 * Fee receipt.
 *
 * Conventional counter stationery: a ruled masthead, a boxed receipt number
 * and date, the classic "received with thanks" declaration, an itemised
 * ledger, the amount in words, and a signed acknowledgement.
 */
export function Receipt() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useFetch(() => api.get(`/finance/receipts/${id}`), [id]);

  if (loading) return <LoadingBlock label="Loading receipt" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { receipt, campus } = data;
  const student = `${receipt.first_name} ${receipt.last_name || ''}`.trim();
  const payable = Number(receipt.total_amount || 0) - Number(receipt.discount_amount || 0);
  const balance = Number(receipt.balance || 0);
  const settled = balance <= 0.01;

  return (
    <>
      <PageHeader
        title="Fee Receipt"
        subtitle={`${receipt.receipt_number} · ${student}`}
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
            <span>{receipt.cancelled ? 'VOID' : 'PAID'}</span>
          </div>

          {/* -------------------------------------------- masthead */}
          <header className="sheet-head plain">
            <div className="sheet-org">
              <h1>{campus?.name || 'Vignan Educational Institutions'}</h1>
              <div className="addr">
                {[campus?.address, campus?.city, campus?.state].filter(Boolean).join(', ')}
                {campus?.pincode ? ` — ${campus.pincode}` : ''}
                <br />
                {[campus?.phone, campus?.email].filter(Boolean).join('   ·   ')}
              </div>
              <div className="affil">FEE COLLECTION COUNTER</div>
            </div>
          </header>
          <hr className="sheet-rule" />

          <div className="sheet-title">
            <h2>Fee Receipt</h2>
            <p>Student Copy</p>
          </div>

          {/* ------------------------------------- number and date */}
          <div className="row row-wrap" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
            <div className="receipt-meta">
              <div className="row-line">
                <span>Receipt No.</span>
                <strong className="mono">{receipt.receipt_number}</strong>
              </div>
              <div className="row-line">
                <span>Date</span>
                <strong>{formatDate(receipt.payment_date)}</strong>
              </div>
            </div>
            <div className="receipt-meta">
              <div className="row-line">
                <span>Mode</span>
                <strong>{String(receipt.payment_mode || '').replace(/_/g, ' ')}</strong>
              </div>
              <div className="row-line">
                <span>Reference</span>
                <strong className="mono">{receipt.transaction_ref || 'Cash'}</strong>
              </div>
            </div>
          </div>

          {/* -------------------------------------- received from */}
          <div className="received-from mt-4">
            <span className="lead">Received with thanks from </span>
            <span className="fill-line">{student}</span>
            <span className="lead">, Admission No. </span>
            <span className="fill-line mono" style={{ minWidth: 120 }}>
              {receipt.admission_number}
            </span>
            <span className="lead">, of class </span>
            <span className="fill-line" style={{ minWidth: 90 }}>
              {receipt.class_name} {receipt.section_name}
            </span>
            <span className="lead">, the sum detailed below towards school fees.</span>
          </div>

          {/* ---------------------------------------- particulars */}
          <div className="sheet-section-label">Particulars</div>
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr>
                  <th className="sn">#</th>
                  <th>Fee Head</th>
                  <th>Category</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="sn">1</td>
                  <td style={{ fontWeight: 600 }}>{receipt.fee_name}</td>
                  <td style={{ color: 'var(--doc-muted)' }}>{receipt.category_name}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatCurrencyExact(receipt.amount)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign: 'right' }}>
                    Total Received
                  </td>
                  <td className="num">{formatCurrencyExact(receipt.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>

          <div className="words-band">
            <span className="k">Rupees (in words)</span>
            <span className="v">{receipt.amount_in_words || '—'}</span>
          </div>

          <div className="grand-total">
            <span className={`stamp ${receipt.cancelled ? 'void' : ''}`}>
              {receipt.cancelled ? 'Cancelled' : 'Paid'}
              <small>{formatDate(receipt.payment_date)}</small>
            </span>
            <div className="box">
              <div className="k">Amount Received</div>
              <div className="v">{formatCurrencyExact(receipt.amount)}</div>
            </div>
          </div>

          {/* ------------------------------------- account position */}
          <div className="sheet-section-label">Fee Account After This Payment</div>
          <TableWrap>
            <table className="ledger">
              <tbody>
                <tr>
                  <td>Total fee for this head</td>
                  <td className="num">{formatCurrencyExact(receipt.total_amount)}</td>
                  <td>Paid to date</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatCurrencyExact(receipt.paid_amount)}
                  </td>
                </tr>
                <tr>
                  <td>Concession allowed</td>
                  <td className="num">
                    {Number(receipt.discount_amount) > 0 ? `− ${formatCurrencyExact(receipt.discount_amount)}` : '—'}
                  </td>
                  <td>Balance outstanding</td>
                  <td
                    className="num"
                    style={{ fontWeight: 700, color: settled ? '#1a7f45' : '#a51d1d' }}
                  >
                    {formatCurrencyExact(balance)}
                    {settled ? '  (Nil)' : ''}
                  </td>
                </tr>
                <tr>
                  <td>Net payable</td>
                  <td className="num">{formatCurrencyExact(payable)}</td>
                  <td>Status</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {settled ? 'Fully Settled' : 'Part Payment'}
                  </td>
                </tr>
              </tbody>
            </table>
          </TableWrap>

          <div className="sign-block single">
            <div>Authorised Signatory</div>
          </div>

          <footer className="sheet-foot">
            <span>
              <Icon name="shield-check" size={10} /> Computer generated receipt — valid without signature. Fees once
              paid are not refundable. Please retain for your records.
            </span>
            <span>Issued {formatDateTime(receipt.issued_at)}</span>
          </footer>
        </article>
      </div>
    </>
  );
}

export default Receipt;
