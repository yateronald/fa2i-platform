/**
 * Session utility for FA2I Platform frontend.
 *
 * Fetches the current user's session info from the backend and provides
 * role-based routing helpers.
 */

import { apiClient } from './apiClient';

const USER_CACHE_KEY = 'fa2i_user';
// Module-level cache so navigations within the SPA don't re-block on /auth/me.
let _cachedUser;

/**
 * Synchronously read the cached current user (module cache, then sessionStorage).
 * Returns null if nothing is cached. Safe during SSR (returns null).
 *
 * @returns {object|null}
 */
export function getCachedUser() {
  if (_cachedUser !== undefined) return _cachedUser;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(USER_CACHE_KEY);
    if (raw) {
      _cachedUser = JSON.parse(raw);
      return _cachedUser;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Clear the cached user (called on logout / auth failure).
 */
export function clearCachedUser() {
  _cachedUser = undefined;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(USER_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Fetch the current authenticated user from the backend.
 * Returns null if the user is not authenticated (401). The result is cached so
 * subsequent page/layout mounts can render instantly without re-blocking on the
 * network.
 *
 * @returns {Promise<{ id: string, email: string, role: string, association_id: string|null } | null>}
 */
export async function getCurrentUser() {
  try {
    const user = await apiClient.get('/auth/me');
    _cachedUser = user;
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
      } catch {
        /* ignore */
      }
    }
    return user;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      clearCachedUser();
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
  clearCachedUser();
  try {
    await apiClient.post('/auth/logout', {});
  } catch {
    /* ignore */
  }
  window.location.href = '/login';
}
