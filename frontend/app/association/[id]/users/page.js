'use client';

import { use } from 'react';
import AssociationUsersManager from '@/components/association/AssociationUsersManager';

/**
 * Association Manager — "Utilisateurs" management tab.
 *
 * Thin wrapper that renders the shared user-management UI scoped to the
 * manager's own association. The backend forces an association manager to
 * their own association, so passing the route id here is correct (and the
 * federation admin reuses the same component with a different id).
 */
export default function AssociationUsersPage({ params }) {
  const { id } = use(params);
  return <AssociationUsersManager associationId={id} />;
}
