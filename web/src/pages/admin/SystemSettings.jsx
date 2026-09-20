import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, LoadingBlock,
  PageHeader, Stat, Tabs, formatDateTime, useFetch,
} from '../../components/ui.jsx';
import { PeriodsPerDay } from '../../components/PeriodsPerDay.jsx';

const CATEGORY_META = {
  GENERAL: { icon: 'building', label: 'General' },
  ACADEMIC: { icon: 'graduation-cap', label: 'Academic' },
  FINANCE: { icon: 'wallet', label: 'Finance' },
  SECURITY: { icon: 'shield', label: 'Security' },
  LIBRARY: { icon: 'library', label: 'Library' },
};

/** Read a megabyte figure back as the unit a person would use. */
function humanMegabytes(value) {
  const mb = Number(value);
  if (!Number.isFinite(mb) || mb <= 0) return 'not set';
  if (mb >= 1048576) return `${(mb / 1048576).toFixed(mb % 1048576 ? 2 : 0)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB`;
  return `${mb} MB`;
}

/** System configuration — Admin only; the API refuses everyone else. */
export function SystemSettings() {
  const toast = useToast();
  const [values, setValues] = useState({});
  const [dirty, setDirty] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState(null);

  const { data: groups, loading, error, refetch } = useFetch(() => api.get('/system/settings'), []);
  const { data: health } = useFetch(() => api.get('/system/health'), []);

  useEffect(() => {
    if (!groups) return;
    const seeded = {};
    for (const group of groups) {
      for (const setting of group.settings) seeded[setting.key] = setting.value ?? '';
    }
    setValues(seeded);
    setDirty(new Set());
    if (!tab) setTab(groups[0]?.category ?? null);
  }, [groups]);

  const update = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setDirty((current) => new Set(current).add(key));
  };

  const save = async () => {
    if (!dirty.size) return;
    setSaving(true);
    try {
      const all = groups.flatMap((group) => group.settings);
      const payload = [...dirty].map((key) => {
        const setting = all.find((item) => item.key === key);
        return {
          key,
          value: String(values[key] ?? ''),
          category: setting?.category,
          label: setting?.label,
          value_type: setting?.value_type,
          is_public: !!setting?.is_public,
        };
      });
      const result = await api.put('/system/settings', { settings: payload });
      toast.success('Settings saved', `${result.data.updated} setting(s) updated and recorded in the audit log.`);
      refetch();
    } catch (saveError) {
      toast.fromError(saveError, 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading system settings" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!groups?.length) {
    return (
      <Card>
        <EmptyState icon="settings" title="No settings configured" />
      </Card>
    );
  }

  const active = groups.find((group) => group.category === tab) || groups[0];

  return (
    <>
      <PageHeader
        title="System Settings"
        subtitle="Institution-wide configuration. Only the Admin can change these values."
        actions={
          <Button variant="primary" icon="save" onClick={save} loading={saving} disabled={!dirty.size}>
            {dirty.size ? `Save ${dirty.size} change(s)` : 'No changes'}
          </Button>
        }
      />

      {health && (
        <div className="grid grid-stats mb-5">
          <Stat label="System status" value="Healthy" icon="check-circle" tone="green" meta={`Node ${health.nodeVersion}`} />
          <Stat label="Uptime" value={`${Math.floor(health.uptimeSeconds / 60)} min`} icon="clock" tone="navy" />
          <Stat label="Memory" value={`${health.memoryMb} MB`} icon="activity" tone="blue" />
          <Stat
            label="Records"
            value={Object.values(health.counts).reduce((sum, value) => sum + value, 0).toLocaleString()}
            icon="layers"
            tone="purple"
            meta={`${health.counts.users} users`}
          />
        </div>
      )}

      <Tabs
        tabs={groups.map((group) => ({
          key: group.category,
          label: CATEGORY_META[group.category]?.label || group.category,
        }))}
        active={active.category}
        onChange={setTab}
      />

      <Card
        title={CATEGORY_META[active.category]?.label || active.category}
        hint={`${active.settings.length} setting(s)`}
      >
        <div className="stack">
          {active.settings.map((setting) => (
            <div
              key={setting.key}
              className="row row-wrap"
              style={{ gap: 16, paddingBottom: 14, borderBottom: '1px solid var(--ink-100)' }}
            >
              <div className="flex-1" style={{ minWidth: 200 }}>
                <div className="row" style={{ gap: 8 }}>
                  <strong className="text-sm">{setting.label || setting.key}</strong>
                  {!!setting.is_public && (
                    <Badge tone="info" dot={false}>
                      Public
                    </Badge>
                  )}
                  {dirty.has(setting.key) && (
                    <Badge tone="warning" dot={false}>
                      Modified
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted mono">{setting.key}</div>
                {setting.description && <div className="field-hint">{setting.description}</div>}
                {setting.updated_by_name && (
                  <div className="text-xs text-subtle mt-2">
                    Last changed by {setting.updated_by_name} · {formatDateTime(setting.updated_at)}
                  </div>
                )}
              </div>
              <div style={{ width: setting.key === 'periods_per_day' ? 320 : 240, maxWidth: '100%' }}>
                {setting.key === 'periods_per_day' ? (
                  <PeriodsPerDay
                    value={values[setting.key] ?? ''}
                    onChange={(next) => update(setting.key, next)}
                  />
                ) : setting.value_type === 'BOOLEAN' ? (
                  <Checkbox
                    label={values[setting.key] === 'true' ? 'Enabled' : 'Disabled'}
                    checked={values[setting.key] === 'true'}
                    onChange={(event) => update(setting.key, String(event.target.checked))}
                  />
                ) : (
                  <>
                    <Input
                      type={setting.value_type === 'NUMBER' ? 'number' : 'text'}
                      value={values[setting.key] ?? ''}
                      onChange={(event) => update(setting.key, event.target.value)}
                    />
                    {/* A limit in megabytes can be a terabyte; say so as it is typed. */}
                    {setting.key === 'storage_limit_mb' && (
                      <div className="field-hint">= {humanMegabytes(values[setting.key])}</div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="error-state mt-5" style={{ background: 'var(--info-50)', borderColor: '#bfdbfe', color: 'var(--info-700)' }}>
          <Icon name="info" size={18} />
          <div>
            <strong>Settings marked Public</strong>
            <p className="text-sm">
              Public settings are readable by the website without authentication — never store secrets here. API keys
              and credentials belong in the server environment file.
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}

export default SystemSettings;
