import styles from './ui.module.css';

export function Spinner({ label = 'Chargement...' }) {
  return (
    <div className={styles.spinnerWrap}>
      <div className={styles.spinner} aria-hidden="true" />
      {label && <span>{label}</span>}
    </div>
  );
}
