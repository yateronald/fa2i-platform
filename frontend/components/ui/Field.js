import styles from './ui.module.css';

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className={styles.field}>
      {label && <label className={styles.label} htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && !error && <span className={styles.hint}>{hint}</span>}
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  );
}

export function Input(props) {
  return <input className={styles.input} {...props} />;
}

export function Textarea(props) {
  return <textarea className={`${styles.input} ${styles.textarea}`} {...props} />;
}
