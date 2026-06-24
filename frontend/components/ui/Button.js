import styles from './ui.module.css';

export function Button({ variant = 'primary', block = false, className = '', ...props }) {
  const variantClass = {
    primary: styles.btnPrimary,
    secondary: styles.btnSecondary,
    outline: styles.btnOutline,
    ghost: styles.btnGhost,
    danger: styles.btnDanger,
  }[variant] || styles.btnPrimary;
  return (
    <button
      className={`${styles.btn} ${variantClass} ${block ? styles.btnBlock : ''} ${className}`}
      {...props}
    />
  );
}
