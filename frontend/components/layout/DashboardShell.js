'use client';
import { useEffect, useState, createContext, useContext } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, logout, getLandingPath } from '@/lib/session';
import { apiClient } from '@/lib/apiClient';
import { resolveMediaUrl } from '@/lib/media';
import { setFavicon, resetFavicon, DEFAULT_FAVICON } from '@/lib/favicon';
import { Spinner } from '@/components/ui/Spinner';
import styles from './DashboardShell.module.css';

export const DashboardContext = createContext({
  extraHeader: null,
  setExtraHeader: () => {},
});

/**
 * Returns true if the given user may access the given pathname area.
 * Enforces role/scope boundaries on the client (the backend enforces them too).
 */
function canAccessArea(user, pathname) {
  if (!user) return false;
  const role = user.role;

  // Federation areas
  if (pathname.startsWith('/federation')) {
    const isFedRole = role === 'FEDERATION_ADMINISTRATOR' || role === 'FEDERATION_ELECTION_MANAGER';
    if (!isFedRole) return false;
    // Associations, Users and Settings are full-admin only
    if (
      pathname.startsWith('/federation/associations') ||
      pathname.startsWith('/federation/users') ||
      pathname.startsWith('/federation/settings')
    ) {
      return role === 'FEDERATION_ADMINISTRATOR';
    }
    return true; // dashboard + elections for both federation roles
  }

  // Association areas: /association/<id>/...
  if (pathname.startsWith('/association/')) {
    const segments = pathname.split('/').filter(Boolean); // ['association', '<id>', ...]
    const targetAssocId = segments[1];
    const subPath = segments[2]; // 'users' | 'federation-voters' | 'elections' | undefined
    const ownsAssoc = user.association_id === targetAssocId;

    // Federation admin may view any association area.
    if (role === 'FEDERATION_ADMINISTRATOR') return true;

    // Evaluate the more specific sub-paths before the generic association rule.
    if (subPath === 'users') {
      // User management: association manager of that association only.
      return role === 'ASSOCIATION_MANAGER' && ownsAssoc;
    }
    if (subPath === 'federation-voters') {
      // Federation voters: association manager of that association, or an
      // election manager of that association allowed to add federation voters.
      if (role === 'ASSOCIATION_MANAGER') return ownsAssoc;
      if (role === 'ASSOCIATION_ELECTION_MANAGER') {
        return ownsAssoc && user.can_add_federation_voters === true;
      }
      return false;
    }
    if (subPath === 'members') {
      // Members: association manager of that association, or an election
      // manager of that association allowed to manage members.
      if (role === 'ASSOCIATION_MANAGER') return ownsAssoc;
      if (role === 'ASSOCIATION_ELECTION_MANAGER') {
        return ownsAssoc && user.can_manage_members === true;
      }
      return false;
    }

    // Generic association area (dashboard, elections): managers and election
    // managers of their own association.
    if (role === 'ASSOCIATION_MANAGER' || role === 'ASSOCIATION_ELECTION_MANAGER') {
      return ownsAssoc;
    }
    return false;
  }

  // Elections area (/elections...) — any authenticated user (voters, managers viewing results)
  if (pathname.startsWith('/elections')) {
    return true;
  }

  return true; // other authenticated pages
}

function deriveTitle(pathname) {
  if (/^\/federation\/associations/.test(pathname)) return 'Associations';
  if (/^\/federation\/elections\/[^/]+$/.test(pathname)) return "Gestion de l'élection";
  if (/^\/federation\/elections/.test(pathname)) return 'Élections fédérales';
  if (/^\/federation\/users/.test(pathname)) return 'Utilisateurs';
  if (/^\/federation\/settings/.test(pathname)) return 'Paramètres';
  if (/^\/federation$/.test(pathname)) return 'Tableau de bord';
  if (/^\/association\/[^/]+\/federation-voters$/.test(pathname)) return 'Électeurs fédération';
  if (/^\/association\/[^/]+\/members$/.test(pathname)) return 'Membres';
  if (/^\/association\/[^/]+\/users$/.test(pathname)) return 'Utilisateurs';
  if (/^\/association\/[^/]+\/elections\/[^/]+$/.test(pathname)) return "Gestion de l'élection";
  if (/^\/association\/[^/]+\/elections$/.test(pathname)) return 'Élections';
  if (/^\/association\/[^/]+$/.test(pathname)) return 'Tableau de bord';
  if (/^\/elections\/[^/]+\/vote$/.test(pathname)) return 'Bulletin de vote';
  if (/^\/elections\/[^/]+\/dashboard$/.test(pathname)) return 'Résultats en direct';
  if (/^\/elections$/.test(pathname)) return 'Mes élections';
  return 'FA2I';
}

function navForRole(user) {
  if (!user) return [];
  if (user.role === 'FEDERATION_ADMINISTRATOR') {
    return [
      { href: '/federation', label: 'Tableau de bord', icon: 'dashboard', exact: true },
      { href: '/federation/associations', label: 'Associations', icon: 'associations' },
      { href: '/federation/elections', label: 'Élections fédérales', icon: 'elections' },
      { href: '/federation/users', label: 'Utilisateurs', icon: 'users' },
      { href: '/federation/settings', label: 'Paramètres', icon: 'settings' },
    ];
  }
  if (user.role === 'FEDERATION_ELECTION_MANAGER') {
    return [
      { href: '/federation', label: 'Tableau de bord', icon: 'dashboard', exact: true },
      { href: '/federation/elections', label: 'Élections fédérales', icon: 'elections' },
    ];
  }
  if (user.role === 'ASSOCIATION_MANAGER') {
    const base = `/association/${user.association_id}`;
    return [
      { href: base, label: 'Tableau de bord', icon: 'dashboard', exact: true },
      { href: `${base}/elections`, label: 'Élections', icon: 'elections' },
      { href: `${base}/members`, label: 'Membres', icon: 'members' },
      { href: `${base}/federation-voters`, label: 'Électeurs fédération', icon: 'voters' },
      { href: `${base}/users`, label: 'Utilisateurs', icon: 'users' },
    ];
  }
  if (user.role === 'ASSOCIATION_ELECTION_MANAGER') {
    const base = `/association/${user.association_id}`;
    const items = [
      { href: base, label: 'Tableau de bord', icon: 'dashboard', exact: true },
      { href: `${base}/elections`, label: 'Élections', icon: 'elections' },
    ];
    if (user.can_manage_members) {
      items.push({ href: `${base}/members`, label: 'Membres', icon: 'members' });
    }
    if (user.can_add_federation_voters) {
      items.push({ href: `${base}/federation-voters`, label: 'Électeurs fédération', icon: 'voters' });
    }
    return items;
  }
  return [
    { href: '/elections', label: 'Mes élections', icon: 'elections', exact: true },
  ];
}

const ROLE_LABELS = {
  FEDERATION_ADMINISTRATOR: 'Administrateur Fédération',
  FEDERATION_ELECTION_MANAGER: "Gestionnaire d'élections",
  ASSOCIATION_MANAGER: 'Gestionnaire Association',
  ASSOCIATION_ELECTION_MANAGER: 'Gestion des élections',
  VOTER: 'Électeur',
};

/* SVG icon components */
function IconDashboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  );
}
function IconAssociations() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21V9l9-6 9 6v12"/><path d="M9 21V12h6v9"/>
    </svg>
  );
}
function IconElections() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}
function IconVoters() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 11l2 2 4-4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>
      <circle cx="9" cy="9" r="2"/><path d="M5 17c0-2.5 2-4 4-4s4 1.5 4 4"/>
    </svg>
  );
}
function IconMembers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );
}
function IconLogout() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  );
}

const ICONS = { dashboard: IconDashboard, associations: IconAssociations, elections: IconElections, users: IconUsers, settings: IconSettings, voters: IconVoters, members: IconMembers };

export default function DashboardShell({ title, children }) {
  const [extraHeader, setExtraHeader] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    getCurrentUser().then((u) => {
      if (!active) return;
      if (!u) { window.location.href = '/login'; return; }
      setUser(u);
      setLoading(false);
    }).catch(() => { window.location.href = '/login'; });
    return () => { active = false; };
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Tab icon (favicon): show the connected association's logo when an
  // association user is logged in; otherwise fall back to the FA2I logo.
  useEffect(() => {
    if (!user) return;
    let active = true;

    const isAssociationUser =
      (user.role === 'ASSOCIATION_MANAGER' ||
        user.role === 'ASSOCIATION_ELECTION_MANAGER') &&
      user.association_id;

    if (!isAssociationUser) {
      resetFavicon();
      return;
    }

    resetFavicon(); // default while the association logo loads
    apiClient
      .get(`/associations/${user.association_id}`)
      .then((data) => {
        if (!active) return;
        const logo = data?.association?.logo_ref;
        const resolved = logo ? resolveMediaUrl(logo) : '';
        setFavicon(resolved || DEFAULT_FAVICON);
      })
      .catch(() => {
        if (active) resetFavicon();
      });

    return () => {
      active = false;
    };
  }, [user]);

  // Enforce area-based authorization on every user/pathname change
  useEffect(() => {
    if (!user) return;
    if (!canAccessArea(user, pathname)) {
      window.location.replace(getLandingPath(user));
    }
  }, [user, pathname]);

  if (loading) {
    return <div className={styles.fullLoading}><Spinner /></div>;
  }
  if (!canAccessArea(user, pathname)) {
    return <div className={styles.fullLoading}><Spinner /></div>;
  }

  const nav = navForRole(user);
  const initials = (user.email || '?').slice(0, 2).toUpperCase();
  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const pageTitle = title || deriveTitle(pathname);

  return (
    <DashboardContext.Provider value={{ extraHeader, setExtraHeader }}>
      <div className={styles.layout}>
        {/* Backdrop for mobile */}
        {mobileOpen && (
          <div className={styles.backdrop} onClick={() => setMobileOpen(false)} />
        )}

        <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}>
          {/* Brand */}
          <div className={styles.brand}>
            <img src="/fa2i-logo.jpg" alt="FA2I" className={styles.brandLogo} />
            <div className={styles.brandText}>
              <span className={styles.brandName}>FA2I</span>
              <span className={styles.brandTag}>Vote &amp; Élections</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className={styles.nav}>
            <div className={styles.navSection}>
              {nav.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : (pathname === item.href || pathname.startsWith(item.href + '/'));
                const IconComp = ICONS[item.icon] || IconDashboard;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                  >
                    <span className={styles.navIcon}><IconComp /></span>
                    <span className={styles.navLabel}>{item.label}</span>
                    {isActive && <span className={styles.navActiveIndicator} />}
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Footer */}
          <div className={styles.sidebarFooter}>
            <div className={styles.userCard}>
              <div className={styles.avatar}>{initials}</div>
              <div className={styles.userInfo}>
                <span className={styles.userEmail}>{user.email}</span>
                <span className={styles.userRole}>{roleLabel}</span>
              </div>
            </div>
            <button className={styles.logoutBtn} onClick={logout}>
              <IconLogout />
              Se déconnecter
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className={styles.main}>
          <header className={styles.topbar}>
            <div className={styles.topbarInner}>
              <button className={styles.menuBtn} onClick={() => setMobileOpen((v) => !v)} aria-label="Menu">
                <IconMenu />
              </button>
              <div className={styles.topbarLeft}>
                <h1 className={styles.pageTitle}>{pageTitle}</h1>
                {extraHeader}
              </div>
              <div className={styles.topbarRight}>
                <span className={styles.tagline}>Dans l&apos;union, nous impacterons</span>
              </div>
            </div>
          </header>
          <main className={styles.content}>{children}</main>
        </div>
      </div>
    </DashboardContext.Provider>
  );
}
