import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useLookups } from '../hooks/useLookups.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ResourcePage } from './ResourcePage.jsx';
import { Button } from './ui.jsx';
import { Icon } from './Icon.jsx';

/**
 * Binds a module config from modules.jsx to <ResourcePage />, supplying the
 * shared lookup data and — for broadcast modules — a publish action.
 */
export function Resource({ config, ...overrides }) {
  const { lookups } = useLookups();
  const { can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [nonce, setNonce] = useState(0);

  const publish = async (row, next) => {
    try {
      await api.post(`${config.endpoint}/${row.id}/publish`, { publish: next });
      toast.success(next ? 'Published' : 'Unpublished', next ? 'Recipients have been notified.' : undefined);
      setNonce((n) => n + 1);
    } catch (error) {
      toast.fromError(error);
    }
  };

  // A `?new=1` link (from a dashboard quick action) opens the create form.
  const [autoOpen, setAutoOpen] = useState(params.get('new') === '1');
  useEffect(() => {
    if (params.get('new') === '1') setAutoOpen(true);
  }, [params]);

  const merged = { ...config, ...overrides, lookups };

  if (config.publishable && can(`${config.module}.publish`)) {
    const original = merged.columns;
    merged.columns = [
      ...original,
      {
        key: '__publish',
        label: '',
        render: (row) => (
          <Button
            size="sm"
            variant={row.is_published ? 'ghost' : 'primary'}
            onClick={(event) => {
              event.stopPropagation();
              publish(row, !row.is_published);
            }}
          >
            <Icon name={row.is_published ? 'eye' : 'send'} size={13} />
            {row.is_published ? 'Unpublish' : 'Publish'}
          </Button>
        ),
      },
    ];
  }

  return <ResourcePage key={`${config.endpoint}-${nonce}`} {...merged} autoOpenCreate={autoOpen} />;
}

export default Resource;
