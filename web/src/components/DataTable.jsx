import { Icon } from './Icon.jsx';
import { EmptyState, ErrorState, Pagination, Skeleton, useMediaQuery } from './ui.jsx';

/**
 * Responsive data table.
 * Renders a real table on wide screens and a stack of record cards on phones,
 * so nothing ever scrolls the page horizontally.
 */
export function DataTable({
  columns,
  rows,
  loading,
  error,
  onRetry,
  meta,
  onPageChange,
  sort,
  onSortChange,
  rowActions,
  onRowClick,
  emptyTitle = 'No records found',
  emptyMessage = 'Try adjusting your search or filters.',
  emptyAction,
  primaryColumn,
  mobileColumns,
}) {
  const isNarrow = useMediaQuery('(max-width: 767px)');

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <Skeleton variant="row" count={6} />
      </div>
    );
  }

  if (!rows?.length) {
    return <EmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} icon="search" />;
  }

  const cellValue = (column, row) => (column.render ? column.render(row) : row[column.key] ?? '—');

  /* ------------------------------------------------------- mobile view */
  if (isNarrow) {
    const primary = primaryColumn || columns[0];
    const fields = (mobileColumns
      ? columns.filter((c) => mobileColumns.includes(c.key))
      : columns.filter((c) => c.key !== primary.key).slice(0, 4)
    ).filter((c) => !c.hideOnMobile);

    return (
      <div>
        <div className="card-list" style={{ padding: 12 }}>
          {rows.map((row, index) => (
            <article
              key={row.id ?? index}
              className="record-card"
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              <div className="record-card-head">
                <div style={{ minWidth: 0 }}>{cellValue(primary, row)}</div>
                {columns.find((c) => c.badge) && (
                  <div>{cellValue(columns.find((c) => c.badge), row)}</div>
                )}
              </div>
              <div className="record-fields">
                {fields
                  .filter((c) => !c.badge)
                  .map((column) => (
                    <div className="record-field" key={column.key}>
                      <div className="k">{column.label}</div>
                      <div className="v">{cellValue(column, row)}</div>
                    </div>
                  ))}
              </div>
              {rowActions && <div className="record-card-actions">{rowActions(row)}</div>}
            </article>
          ))}
        </div>
        {meta && onPageChange && <Pagination {...meta} onChange={onPageChange} />}
      </div>
    );
  }

  /* ------------------------------------------------------ desktop view */
  const toggleSort = (column) => {
    if (!column.sortable || !onSortChange) return;
    const next =
      sort?.column === column.key && sort.order === 'desc'
        ? { column: column.key, order: 'asc' }
        : { column: column.key, order: 'desc' };
    onSortChange(next);
  };

  return (
    <div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`${column.numeric ? 'num' : ''} ${column.sortable ? 'sortable' : ''}`}
                  style={column.width ? { width: column.width } : undefined}
                  onClick={() => toggleSort(column)}
                >
                  <span className="row" style={{ gap: 4, display: 'inline-flex' }}>
                    {column.label}
                    {column.sortable && sort?.column === column.key && (
                      <Icon name={sort.order === 'asc' ? 'chevron-up' : 'chevron-down'} size={12} />
                    )}
                  </span>
                </th>
              ))}
              {rowActions && <th className="num">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.id ?? index}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric ? 'num' : ''}>
                    {cellValue(column, row)}
                  </td>
                ))}
                {rowActions && (
                  <td className="actions" onClick={(event) => event.stopPropagation()}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      {rowActions(row)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && onPageChange && <Pagination {...meta} onChange={onPageChange} />}
    </div>
  );
}

export default DataTable;
