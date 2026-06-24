import styles from './ui.module.css';

export function Alert({ type = 'error', children }) {
  if (!children) return null;
  const cls = type === 'success' ? styles.alertSuccess : styles.alertError;
  return <div className={`${styles.alert} ${cls}`} role="alert">{children}</div>;
}
