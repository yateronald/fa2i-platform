'use client';

import { useEffect } from 'react';
import { getCurrentUser, getLandingPath } from '@/lib/session';

/**
 * Root page — redirects authenticated users to their role-based landing page.
 * Unauthenticated users are redirected to /login.
 */
export default function Home() {
  useEffect(() => {
    async function redirect() {
      try {
        const user = await getCurrentUser();
        if (user) {
          window.location.href = getLandingPath(user);
        } else {
          window.location.href = '/login';
        }
      } catch {
        window.location.href = '/login';
      }
    }
    redirect();
  }, []);

  return null;
}
