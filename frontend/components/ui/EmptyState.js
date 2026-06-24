import styles from './ui.module.css';

export function EmptyState({ icon = '📭', title, text }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIconWrap}>
        <span className={styles.emptyIcon}>{icon}</span>
      </div>
      {title && <div className={styles.emptyTitle}>{title}</div>}
      {text && <div className={styles.emptyText}>{text}</div>}
    </div>
  );
}
