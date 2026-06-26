'use client';
import styles from './ui.module.css';

export function Modal({ open, title, onClose, children, size = 'md' }) {
  if (!open) return null;
  const sizeClass = size === 'lg' ? styles.modalLg : '';
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={`${styles.modal} ${sizeClass}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{title}</span>
          <button className={styles.modalClose} onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}
