import { useEffect } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ChildSwitcher } from './ChildSwitcher.jsx';
import { EmptyState, ErrorState, PageHeader, StatSkeleton, useFetch } from '../../components/ui.jsx';
import { StudentOverview } from './StudentOverview.jsx';

export function ParentDashboard() {
  const { user, selectedChildId, selectChild, children } = useAuth();

  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/dashboards/parent${selectedChildId ? `?student_id=${selectedChildId}` : ''}`),
    [selectedChildId]
  );

  /*
   * On first load nothing is selected, so the child the API picked is adopted.
   *
   * Once the parent has chosen one, their choice wins. Syncing on every render
   * raced the refetch: the moment they picked a second child, `data` still held
   * the first, so this fired and put the selection straight back — the page
   * never changed, however many times they clicked.
   */
  useEffect(() => {
    if (!selectedChildId && data?.selectedChild) selectChild(data.selectedChild.id);
  }, [data, selectedChildId, selectChild]);

  if (loading) {
    return (
      <>
        <PageHeader title="Parent Dashboard" subtitle="Loading your child's information..." />
        <StatSkeleton count={4} />
      </>
    );
  }
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (!children.length) {
    return (
      <>
        <PageHeader title="Parent Dashboard" />
        <EmptyState
          icon="users"
          title="No children linked"
          message="No student is linked to this parent account yet. Please contact the school office."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.fullName.split(' ')[0]}`}
        subtitle="Monitor attendance, results, fees and school communication for your children."
      />
      <ChildSwitcher />
      <StudentOverview dashboard={data.dashboard} prefix="/parent" showNotifications={false} />
    </>
  );
}

export default ParentDashboard;
