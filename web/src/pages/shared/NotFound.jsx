import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, EmptyState } from '../../components/ui.jsx';

export function NotFound() {
  const { user } = useAuth();
  return (
    <Card>
      <EmptyState
        icon="compass"
        title="Page not found"
        message="That page does not exist, or your role does not have access to it."
        action={
          <Link to={user?.home || '/login'} className="btn btn-primary">
            Back to my dashboard
          </Link>
        }
      />
    </Card>
  );
}

export default NotFound;
