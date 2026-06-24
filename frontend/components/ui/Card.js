import styles from './ui.module.css';

export function Card({ children, className = '' }) {
  return <div className={`${styles.card} ${className}`}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className={styles.cardHeader}>
      <div>
        <div className={styles.cardTitle}>{title}</div>
        {subtitle && <div className={styles.cardSubtitle}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
