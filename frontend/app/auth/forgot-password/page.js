'use client';

import { useState, useMemo, useRef } from 'react';
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

const CODE_LENGTH = 6;
const STEPS = ['request', 'code', 'password'];

export default function ForgotPasswordPage() {
  const [step, setStep] = useState('request');

  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState(() => Array(CODE_LENGTH).fill(''));
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showNew, setShowNew] = useState(false);

  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [remaining, setRemaining] = useState(null);

  const inputsRef = useRef([]);

  const code = digits.join('');
  const codeComplete = digits.every((d) => d !== '');

  const ruleStatus = useMemo(
    () => RULES.map((r) => ({ ...r, met: r.test(newPassword) })),
    [newPassword]
  );
  const allRulesMet = ruleStatus.every((r) => r.met);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirm;
  const metCount = ruleStatus.filter((r) => r.met).length;
  const strength = metCount <= 2 ? 'weak' : metCount <= 4 ? 'medium' : 'strong';
  const strengthLabel = { weak: 'Faible', medium: 'Moyen', strong: 'Fort' }[strength];
  const canReset = allRulesMet && passwordsMatch && !loading;

  const SENT_MESSAGE =
    'Si cette adresse est enregistrée, un code de réinitialisation vient de vous être envoyé.';

  function resetCodeBoxes() {
    setDigits(Array(CODE_LENGTH).fill(''));
    setTimeout(() => inputsRef.current[0]?.focus(), 0);
  }

  /* ── Step 1: request the code ─────────────────────────────── */
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
    } catch {
      /* non-revealing: ignore */
    } finally {
      setLoading(false);
    }
    setLocked(false);
    setRemaining(null);
    setDigits(Array(CODE_LENGTH).fill(''));
    setStep('code');
    setInfo(SENT_MESSAGE);
    setTimeout(() => inputsRef.current[0]?.focus(), 50);
  }

  /* ── Resend a fresh code ──────────────────────────────────── */
  async function handleResend() {
    if (resending || !email.trim()) return;
    setError('');
    setResending(true);
    try {
      await apiClient.post('/auth/forgot-password', { email: email.trim() });
      setInfo(SENT_MESSAGE);
      setLocked(false);
      setRemaining(null);
      resetCodeBoxes();
    } catch {
      setInfo(SENT_MESSAGE);
    } finally {
      setResending(false);
    }
  }

  /* ── Step 2: verify the code ──────────────────────────────── */
  async function handleVerify(e) {
    e.preventDefault();
    if (!codeComplete || loading) return;
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/auth/verify-reset-code', { email: email.trim(), code });
      // Code confirmed → advance to the password step.
      setStep('password');
      setInfo('');
      setError('');
    } catch (err) {
      const body = err.body || {};
      if (body.locked) {
        setLocked(true);
        setError('Trop de tentatives. Demandez un nouveau code pour continuer.');
      } else {
        const left = typeof body.remainingAttempts === 'number' ? body.remainingAttempts : null;
        setRemaining(left);
        setError(
          left != null
            ? `Code incorrect. Il vous reste ${left} tentative${left > 1 ? 's' : ''}.`
            : 'Code incorrect.'
        );
        resetCodeBoxes();
      }
    } finally {
      setLoading(false);
    }
  }

  /* ── Step 3: set the new password ─────────────────────────── */
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
        code,
        newPassword,
      });
      setSuccess(true);
      setTimeout(() => {
        window.location.href = '/login';
      }, 1800);
    } catch (err) {
      const msg = err.body?.error || err.message || 'Une erreur est survenue.';
      // If the code expired/was invalidated between steps, send the user back.
      if (/code|tentative/i.test(msg)) {
        setStep('code');
        setLocked(true);
        setError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  /* ── OTP input handlers ───────────────────────────────────── */
  function handleDigitChange(index, value) {
    const onlyDigits = value.replace(/\D/g, '');
    if (!onlyDigits) {
      setDigits((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }
    setDigits((prev) => {
      const next = [...prev];
      // If multiple chars arrived (e.g. quick typing), spread them forward.
      const chars = onlyDigits.split('');
      let i = index;
      for (const ch of chars) {
        if (i >= CODE_LENGTH) break;
        next[i] = ch;
        i += 1;
      }
      const focusIdx = Math.min(i, CODE_LENGTH - 1);
      setTimeout(() => inputsRef.current[focusIdx]?.focus(), 0);
      return next;
    });
  }

  function handleDigitKeyDown(index, e) {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        setDigits((prev) => {
          const next = [...prev];
          next[index] = '';
          return next;
        });
      } else if (index > 0) {
        inputsRef.current[index - 1]?.focus();
        setDigits((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function handlePaste(e) {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!text) return;
    e.preventDefault();
    const next = Array(CODE_LENGTH).fill('');
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setDigits(next);
    const focusIdx = Math.min(text.length, CODE_LENGTH - 1);
    setTimeout(() => inputsRef.current[focusIdx]?.focus(), 0);
  }

  const stepIndex = STEPS.indexOf(step);

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

        <div className={styles.form}>
          {/* Step indicator */}
          <div className={extra.stepper} aria-hidden="true">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`${extra.stepDot} ${
                  i === stepIndex ? extra.stepDotActive : i < stepIndex ? extra.stepDotDone : ''
                }`}
              />
            ))}
          </div>

          {step === 'request' && (
            <form onSubmit={handleRequest} className={extra.stepForm}>
              <h2 className={styles.formTitle}>Mot de passe oublié</h2>
              <p className={styles.intro}>
                Saisissez votre adresse email. Si elle est enregistrée, vous recevrez un code à
                6 chiffres pour réinitialiser votre mot de passe.
              </p>

              {error && <p className={styles.errorMessage} role="alert">{error}</p>}

              <div className={styles.formGroup}>
                <label htmlFor="email" className={styles.label}>Adresse email</label>
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
                <Link href="/login" className={extra.linkButton}>Retour à la connexion</Link>
              </div>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={handleVerify} className={extra.stepForm}>
              <h2 className={styles.formTitle}>Saisir le code</h2>
              <p className={styles.intro}>
                Entrez le code à 6 chiffres envoyé à <strong>{email}</strong>.
              </p>

              {info && !error && <p className={extra.infoMessage}>{info}</p>}
              {error && <p className={styles.errorMessage} role="alert">{error}</p>}

              <div
                className={extra.otpRow}
                onPaste={handlePaste}
                role="group"
                aria-label="Code de réinitialisation à 6 chiffres"
              >
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => (inputsRef.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    className={`${extra.otpInput} ${d ? extra.otpInputFilled : ''}`}
                    value={d}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(i, e)}
                    onFocus={(e) => e.target.select()}
                    disabled={locked}
                    aria-label={`Chiffre ${i + 1}`}
                  />
                ))}
              </div>

              {!locked && (
                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={!codeComplete || loading}
                >
                  {loading ? 'Vérification...' : 'Suivant'}
                </button>
              )}

              {locked && (
                <button
                  type="button"
                  className={styles.submitButton}
                  onClick={handleResend}
                  disabled={resending}
                >
                  {resending ? 'Envoi...' : 'Générer un nouveau code'}
                </button>
              )}

              {!locked && (
                <div className={extra.resendRow}>
                  <span className={extra.resendHint}>Vous n’avez pas reçu le code ?</span>
                  <button
                    type="button"
                    className={extra.linkButton}
                    onClick={handleResend}
                    disabled={resending}
                  >
                    {resending ? 'Renvoi...' : 'Renvoyer le code'}
                  </button>
                </div>
              )}

              <div className={extra.footerLinks}>
                <Link href="/login" className={extra.linkButton}>Retour à la connexion</Link>
              </div>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={handleReset} className={extra.stepForm}>
              <h2 className={styles.formTitle}>Nouveau mot de passe</h2>

              {success ? (
                <p className={styles.successMessage} role="status">
                  Mot de passe réinitialisé avec succès. Redirection vers la connexion...
                </p>
              ) : (
                <>
                  <div className={extra.verifiedBadge}>
                    <span className={extra.verifiedCheck}>✓</span> Code vérifié — choisissez votre
                    nouveau mot de passe.
                  </div>

                  {error && <p className={styles.errorMessage} role="alert">{error}</p>}

                  <div className={styles.formGroup}>
                    <label htmlFor="newPassword" className={styles.label}>Nouveau mot de passe</label>
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
                    <label htmlFor="confirm" className={styles.label}>Confirmer le mot de passe</label>
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
                      <span className={styles.matchError}>Les mots de passe ne correspondent pas</span>
                    )}
                  </div>

                  <button type="submit" className={styles.submitButton} disabled={!canReset}>
                    {loading ? 'Réinitialisation...' : 'Réinitialiser le mot de passe'}
                  </button>

                  <div className={extra.footerLinks}>
                    <Link href="/login" className={extra.linkButton}>Retour à la connexion</Link>
                  </div>
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
