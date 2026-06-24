'use client';
import { Modal } from './Modal';
import { Button } from './Button';
import { Alert } from './Alert';
import styles from './ui.module.css';

/**
 * A proper in-app confirmation dialog to replace native window.confirm().
 *
 * The destructive/primary action only runs when the user clicks the confirm
 * button. While the action is in flight the buttons are disabled.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.title
 * @param {React.ReactNode} props.message
 * @param {string} [props.confirmLabel='Confirmer']
 * @param {string} [props.cancelLabel='Annuler']
 * @param {'primary'|'danger'} [props.variant='danger']
 * @param {boolean} [props.busy=false]
 * @param {string} [props.error]
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'danger',
  busy = false,
  error = '',
  onConfirm,
  onCancel,
}) {
  return (
    <Modal open={open} title={title} onClose={busy ? () => {} : onCancel}>
      {error && <Alert>{error}</Alert>}
      <div className={styles.confirmMessage}>{message}</div>
      <div className={styles.formActions}>
        <Button variant={variant} onClick={onConfirm} disabled={busy}>
          {busy ? 'En cours...' : confirmLabel}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
      </div>
    </Modal>
  );
}
