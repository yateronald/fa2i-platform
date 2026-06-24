'use client';
import styles from './ui.module.css';

export function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{title}</span>
          <button className={styles.modalClose} onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}
