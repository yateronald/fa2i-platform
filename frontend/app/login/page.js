'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { getLandingPath } from '@/lib/session';
import styles from './login.module.css';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await apiClient.post('/auth/login', { identifier, password });

      if (result.mustRotatePassword) {
        // Forced password rotation on first login (Req 4.1, 5.1)
        window.location.href = '/auth/change-password';
      } else {
        // Route to role-appropriate landing view (Req 6.1, 6.2, 6.3)
        window.location.href = getLandingPath(result.user);
      }
    } catch (err) {
      setError(err.message || 'Identifiants invalides');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <aside className={styles.hero}>
          <div className={styles.heroInner}>
            <img src="/fa2i-logo.jpg" alt="FA2I" className={styles.heroLogo} />
            <h1 className={styles.heroTitle}>
              Fédération des Associations Ivoiriennes en Inde
            </h1>
            <p className={styles.heroTagline}>Dans l&apos;union, nous impacterons</p>
          </div>
        </aside>

        <section className={styles.formPanel}>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.formHead}>
              <h2 className={styles.formTitle}>Connexion</h2>
              <p className={styles.formSubtitle}>Accédez à votre espace</p>
            </div>

            {error && (
              <p className={styles.errorMessage} role="alert">
                {error}
              </p>
            )}

            <div className={styles.formGroup}>
              <label htmlFor="identifier" className={styles.label}>
                Identifiant (email)
              </label>
              <input
                id="identifier"
                type="text"
                className={styles.input}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoComplete="username"
                placeholder="votre@email.com"
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="password" className={styles.label}>
                Mot de passe
              </label>
              <div className={styles.inputWrapper}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Votre mot de passe"
                />
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  {showPassword ? 'Masquer' : 'Voir'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading}
            >
              {loading ? 'Connexion en cours...' : 'Se connecter'}
            </button>

            <div className={styles.forgotRow}>
              <a href="/auth/forgot-password" className={styles.forgotLink}>
                Mot de passe oublié ?
              </a>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
