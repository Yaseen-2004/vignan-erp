import { useAuth } from '../context/AuthContext.jsx';

/**
 * The student whose data the current portal screen should show.
 *
 *   STUDENT -> their own record
 *   PARENT  -> the child selected in the header switcher
 *
 * The API independently verifies the caller may read that student, so this is
 * only about choosing what to ask for.
 */
export function useActiveStudent() {
  const { user, profile, selectedChild, selectedChildId, children } = useAuth();

  if (user.role === 'PARENT') {
    return {
      studentId: selectedChildId,
      student: selectedChild,
      isParent: true,
      hasChildren: children.length > 0,
      prefix: '/parent',
    };
  }

  return {
    studentId: profile?.id ?? null,
    student: profile,
    isParent: false,
    hasChildren: true,
    prefix: '/parent',
  };
}

export default useActiveStudent;
