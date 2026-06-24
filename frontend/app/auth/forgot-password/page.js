'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/apiClient';
import styles from '../change-password/change-password.module.css';
import extra from './forgot-password.module.css';

const RULES = [
  { key: 'length', label: 'Au moins 12 caractères', test: (p) => p.length >= 12 },
  { key: 'upper', label: 'Une lettre majuscule', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'Une lettre minuscule', test: (p) => /[a-z]/.test(p) },
  { key: 'digit', label: 'Un chiffre', test: (p) => /[0-9]/.test(p) },
  { key: 'symbol', label: 'Un symbole', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export default function ForgotPasswordPage() {
  // 'request' = enter email; 'reset' = enter code + new password
  const [step, setStep] = useState('request');

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showNew, setShowNew] = useState(false);

  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const ruleStatus = useMemo(
    () => RULES.map((r) => ({ ...r, met: r.test(newPassword) })),
    [newPassword]
  );
  const allRulesMet = ruleStatus.every((r) => r.met);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirm;
  const metCount = ruleStatus.filter((r) => r.met).length;
  const strength = metCount <= 2 ? 'weak' : metCount <= 4 ? 'medium' : 'strong';
  const strengthLabel = { weak: 'Faible', medium: 'Moyen', strong: 'Fort' }[strength];

  const canReset =
    code.trim().length > 0 && allRulesMet && passwordsMatch && !loading;

  // The non-revealing message shown after requesting (and on resend).
  const SENT_MESSAGE =
    'Si cette adresse est enregistrée, vous recevrez un code de réinitialisation. Saisissez-le ci-dessous.';

  async function handleRequest(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!email.trim()) {
      setError('Veuillez saisir votre adresse email.');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/auth/forgot-password', { email: email.trim() });
      // Always move forward — never disclose whether the email exists.
      setStep('reset');
      setInfo(SENT_MESSAGE);
    } catch {
      // Backend responds uniformly; treat any error as the same non-revealing flow.
      setStep('reset');
      setInfo(SENT_MESSAGE);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resending || !email.trim()) return;
    setError('');
    setResending(true);
    try {
      await apiClient.post('/auth/forgot-password', { email: email.trim() });
      setInfo(SENT_MESSAGE);
    } catch {
      setInfo(SENT_MESSAGE);
    } finally {
      setResending(false);
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    setError('');
    if (!passwordsMatch) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/auth/reset-password', {
        email: email.trim(),
        code: code.trim(),
        newPassword,
      });
      setSuccess(true);
      setInfo('');
      setTimeout(() => {
        window.location.href = '/login';
      }, 1800);
    } catch (err) {
      setError(err.body?.error || err.message || 'Code invalide ou expiré.');
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

        {step === 'request' ? (
          <form onSubmit={handleRequest} className={styles.form}>
            <h2 className={styles.formTitle}>Mot de passe oublié</h2>
            <p className={styles.intro}>
              Saisissez votre adresse email. Si elle est enregistrée, vous recevrez un code pour
              réinitialiser votre mot de passe.
            </p>

            {error && (
              <p className={styles.errorMessage} role="alert">
                {error}
              </p>
            )}

            <div className={styles.formGroup}>
              <label htmlFor="email" className={styles.label}>
                Adresse email
              </label>
              <input
                id="email"
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="votre@email.com"
              />
            </div>

            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Envoi...' : 'Envoyer le code'}
            </button>

            <div className={extra.footerLinks}>
              <Link href="/login" className={extra.linkButton}>
                Retour à la connexion
              </Link>
            </div>
          </form>
        ) : (
          <form onSubmit={handleReset} className={styles.form}>
            <h2 className={styles.formTitle}>Réinitialiser le mot de passe</h2>

            {success ? (
              <p className={styles.successMessage} role="status">
                Mot de passe réinitialisé avec succès. Redirection vers la connexion...
              </p>
            ) : (
              <>
                {info && <p className={extra.infoMessage}>{info}</p>}
                {error && (
                  <p className={styles.errorMessage} role="alert">
                    {error}
                  </p>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor="code" className={styles.label}>
                    Code de réinitialisation
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className={`${styles.input} ${extra.codeInput}`}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    placeholder="000000"
                  />
                  <div className={extra.resendRow}>
                    <span className={styles.label} style={{ fontWeight: 600, color: '#667085' }}>
                      Vous n’avez pas reçu le code ?
                    </span>
                    <button
                      type="button"
                      className={extra.linkButton}
                      onClick={handleResend}
                      disabled={resending}
                    >
                      {resending ? 'Renvoi...' : 'Renvoyer le code'}
                    </button>
                  </div>
                </div>

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
                  <input
                    id="confirm"
                    type={showNew ? 'text' : 'password'}
                    className={styles.input}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="Confirmez votre mot de passe"
                  />
                  {confirm.length > 0 && !passwordsMatch && (
                    <span className={styles.matchError}>
                      Les mots de passe ne correspondent pas
                    </span>
                  )}
                </div>

                <button type="submit" className={styles.submitButton} disabled={!canReset}>
                  {loading ? 'Réinitialisation...' : 'Réinitialiser le mot de passe'}
                </button>

                <div className={extra.footerLinks}>
                  <Link href="/login" className={extra.linkButton}>
                    Retour à la connexion
                  </Link>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
