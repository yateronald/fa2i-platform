'use client';

import { useState, useMemo } from 'react';
import { apiClient } from '@/lib/apiClient';
import styles from './change-password.module.css';

const RULES = [
  { key: 'length', label: 'Au moins 12 caractères', test: (p) => p.length >= 12 },
  { key: 'upper', label: 'Une lettre majuscule', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'Une lettre minuscule', test: (p) => /[a-z]/.test(p) },
  { key: 'digit', label: 'Un chiffre', test: (p) => /[0-9]/.test(p) },
  { key: 'symbol', label: 'Un symbole', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export default function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const ruleStatus = useMemo(
    () => RULES.map((r) => ({ ...r, met: r.test(newPassword) })),
    [newPassword]
  );
  const allRulesMet = ruleStatus.every((r) => r.met);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirm;
  const metCount = ruleStatus.filter((r) => r.met).length;

  // strength: 'weak' | 'medium' | 'strong'
  const strength = metCount <= 2 ? 'weak' : metCount <= 4 ? 'medium' : 'strong';
  const strengthLabel = { weak: 'Faible', medium: 'Moyen', strong: 'Fort' }[strength];

  const canSubmit = allRulesMet && passwordsMatch && !loading;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!passwordsMatch) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/auth/change-password', { newPassword });
      setSuccess(true);
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    } catch (err) {
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <img src="/fa2i-logo.jpg" alt="FA2I" className={styles.logo} />
          <div className={styles.brandCopy}>
            <p className={styles.eyebrow}>FA2I</p>
            <h1 className={styles.brandName}>
              Fédération des Associations Ivoiriennes en Inde
            </h1>
          </div>
        </header>

        <form onSubmit={handleSubmit} className={styles.form}>
          <h2 className={styles.formTitle}>Changer le mot de passe</h2>
          <p className={styles.intro}>
            Créez un mot de passe sécurisé pour continuer vers votre espace.
          </p>

          {success && (
            <p className={styles.successMessage} role="status">
              Mot de passe modifié avec succès. Redirection...
            </p>
          )}
          {error && (
            <p className={styles.errorMessage} role="alert">
              {error}
            </p>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="newPassword" className={styles.label}>
              Nouveau mot de passe
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="newPassword"
                type={showNew ? 'text' : 'password'}
                className={styles.input}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="Votre nouveau mot de passe"
              />
              <button
                type="button"
                className={styles.toggle}
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showNew ? 'Masquer' : 'Voir'}
              </button>
            </div>
          </div>

          {newPassword.length > 0 && (
            <div className={styles.strength}>
              <span className={styles.strengthText}>Niveau</span>
              <div className={styles.strengthBar}>
                <div className={`${styles.strengthFill} ${styles[strength]}`} />
              </div>
              <span className={`${styles.strengthLabel} ${styles[strength]}`}>
                {strengthLabel}
              </span>
            </div>
          )}

          <ul className={styles.rules}>
            {ruleStatus.map((r) => (
              <li key={r.key} className={r.met ? styles.ruleMet : styles.ruleUnmet}>
                <span className={styles.ruleIcon} aria-hidden="true" />
                {r.label}
              </li>
            ))}
          </ul>

          <div className={styles.formGroup}>
            <label htmlFor="confirm" className={styles.label}>
              Confirmer le mot de passe
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="confirm"
                type={showConfirm ? 'text' : 'password'}
                className={styles.input}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="Confirmez votre mot de passe"
              />
              <button
                type="button"
                className={styles.toggle}
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showConfirm ? 'Masquer' : 'Voir'}
              </button>
            </div>
            {confirm.length > 0 && !passwordsMatch && (
              <span className={styles.matchError}>
                Les mots de passe ne correspondent pas
              </span>
            )}
          </div>

          <button type="submit" className={styles.submitButton} disabled={!canSubmit}>
            {loading ? 'Modification...' : 'Définir le mot de passe'}
          </button>
        </form>
      </div>
    </main>
  );
}
