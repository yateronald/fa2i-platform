/**
 * Session utility for FA2I Platform frontend.
 *
 * Fetches the current user's session info from the backend and provides
 * role-based routing helpers.
 */

import { apiClient } from './apiClient';

/**
 * Fetch the current authenticated user from the backend.
 * Returns null if the user is not authenticated (401).
 *
 * @returns {Promise<{ id: string, email: string, role: string, association_id: string|null } | null>}
 */
export async function getCurrentUser() {
  try {
    const user = await apiClient.get('/auth/me');
    return user;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return null;
    }
    throw err;
  }
}

/**
 * Determine the landing path for a user based on their role.
 *
 * @param {{ role: string, association_id: string|null }} user
 * @returns {string} The path to redirect to
 */
export function getLandingPath(user) {
  switch (user.role) {
    case 'FEDERATION_ADMINISTRATOR':
    case 'FEDERATION_ELECTION_MANAGER':
      return '/federation';
    case 'ASSOCIATION_MANAGER':
    case 'ASSOCIATION_ELECTION_MANAGER':
      return `/association/${user.association_id}`;
    case 'VOTER':
      return '/elections';
    default:
      return '/login';
  }
}

/**
 * Log the current user out by calling the backend logout endpoint and
 * redirecting to the login page. Errors are ignored so the redirect
 * always happens.
 *
 * @returns {Promise<void>}
 */
export async function logout() {
  try {
    await apiClient.post('/auth/logout', {});
  } catch {
    /* ignore */
  }
  window.location.href = '/login';
}
