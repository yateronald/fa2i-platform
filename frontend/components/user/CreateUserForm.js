'use client';
import { useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { Field, Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';

const selectStyle = {
  padding: '0.65rem 0.85rem',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.95rem',
  width: '100%',
};

export default function CreateUserForm({ onSuccess, onCancel }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('FEDERATION_ELECTION_MANAGER');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.post('/users', { email, role });
      onSuccess(res.user);
    } catch (err) {
      const msg = err.body?.errors
        ? err.body.errors.join(', ')
        : (err.body?.error || err.message || 'Erreur');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      <Field
        label="Email"
        hint="Un mot de passe temporaire sera envoyé à cette adresse."
        htmlFor="uemail"
      >
        <Input
          id="uemail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
        />
      </Field>
      <Field label="Rôle" htmlFor="urole">
        <select
          id="urole"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          style={selectStyle}
        >
          <option value="FEDERATION_ADMINISTRATOR">Administrateur (accès complet)</option>
          <option value="FEDERATION_ELECTION_MANAGER">Gestionnaire d&apos;élections</option>
        </select>
      </Field>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Création...' : "Créer l'utilisateur"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
