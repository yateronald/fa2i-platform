import styles from './ui.module.css';

export function Button({ variant = 'primary', size, block = false, className = '', ...props }) {
  const variantClass = {
    primary: styles.btnPrimary,
    secondary: styles.btnSecondary,
    outline: styles.btnOutline,
    ghost: styles.btnGhost,
    danger: styles.btnDanger,
  }[variant] || styles.btnPrimary;
  const sizeClass = size === 'sm' ? styles.btnSm : '';
  return (
    <button
      className={`${styles.btn} ${variantClass} ${sizeClass} ${block ? styles.btnBlock : ''} ${className}`}
      {...props}
    />
  );
}
