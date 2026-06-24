/**
 * API Client for FA2I Platform
 *
 * Reads APP_BASE_URL from environment (NEXT_PUBLIC_APP_BASE_URL for client-side use)
 * and includes credentials: 'include' in every request to forward the session cookie.
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_BASE_URL || 'http://localhost:4000';

/**
 * Shared fetch wrapper that forwards the session cookie and handles JSON.
 *
 * @param {string} path - API path (e.g. '/auth/login')
 * @param {object} options - fetch options override
 * @returns {Promise<any>} parsed JSON response
 * @throws {Error} with message from the API or a generic network error
 */
async function fetchWrapper(path, options = {}) {
  const url = `${BASE_URL}${path}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Forward session cookie
  });

  // Parse JSON body (or null for 204)
  const body = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    const message =
      body?.message || body?.error || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

/**
 * API client with convenience methods for each HTTP verb.
 */
export const apiClient = {
  /**
   * GET request
   * @param {string} path
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  get(path, options = {}) {
    return fetchWrapper(path, { ...options, method: 'GET' });
  },

  /**
   * POST request
   * @param {string} path
   * @param {any} data - request body (will be JSON-stringified)
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  post(path, data, options = {}) {
    return fetchWrapper(path, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * PUT request
   * @param {string} path
   * @param {any} data - request body (will be JSON-stringified)
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  put(path, data, options = {}) {
    return fetchWrapper(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * PATCH request
   * @param {string} path
   * @param {any} data - request body (will be JSON-stringified)
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  patch(path, data, options = {}) {
    return fetchWrapper(path, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  /**
   * DELETE request
   * @param {string} path
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  delete(path, options = {}) {
    return fetchWrapper(path, { ...options, method: 'DELETE' });
  },
};
