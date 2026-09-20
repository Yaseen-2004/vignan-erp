import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Resource } from './Resource.jsx';
import { Card, EmptyState, PageHeader, Tabs } from './ui.jsx';

/**
 * Groups several related module configs behind one set of tabs — the way
 * Academics, Fees, Transport, Library and Inventory are presented in
 * the Admin navigation. Tabs the user has no permission for are hidden.
 */
export function ModuleTabs({ title, subtitle, tabs }) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();

  const visible = tabs.filter((tab) => !tab.permission || can(tab.permission));
  const requested = params.get('tab');
  const [active, setActive] = useState(
    visible.find((tab) => tab.key === requested)?.key || visible[0]?.key
  );

  const change = (key) => {
    setActive(key);
    const next = new URLSearchParams(params);
    next.set('tab', key);
    next.delete('new');
    setParams(next, { replace: true });
  };

  if (!visible.length) {
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} />
        <Card>
          <EmptyState icon="lock" title="No access" message="Your role does not include any of these modules." />
        </Card>
      </>
    );
  }

  const current = visible.find((tab) => tab.key === active) || visible[0];

  return (
    <>
      <div className="mb-4">
        <h2 style={{ fontSize: 'var(--text-2xl)' }}>{title}</h2>
        {subtitle && <p className="subtitle text-muted">{subtitle}</p>}
      </div>

      <Tabs tabs={visible.map((tab) => ({ key: tab.key, label: tab.label }))} active={current.key} onChange={change} />

      {current.element ? current.element : <Resource key={current.key} config={current.config} />}
    </>
  );
}

export default ModuleTabs;
