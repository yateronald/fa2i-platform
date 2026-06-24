import styles from './ui.module.css';

export function Badge({ variant = 'neutral', children }) {
  const v = {
    open: styles.badgeOpen,
    closed: styles.badgeClosed,
    neutral: styles.badgeNeutral,
    warn: styles.badgeWarn,
  }[variant] || styles.badgeNeutral;
  return <span className={`${styles.badge} ${v}`}>{children}</span>;
}

export function StateBadge({ state }) {
  if (state === 'OPEN') return <Badge variant="open">● Ouverte</Badge>;
  if (state === 'DRAFT') return <Badge variant="neutral">Brouillon</Badge>;
  if (state === 'PENDING') return <Badge variant="warn">À venir</Badge>;
  return <Badge variant="closed">● Fermée</Badge>;
}
