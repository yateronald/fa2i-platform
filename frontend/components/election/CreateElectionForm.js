'use client';
import { useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { Field, Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { detectTimezone, commonTimezones, zonedWallTimeToUTCISO } from '@/lib/timezone';

export default function CreateElectionForm({ onSuccess, onCancel, isFederation = false }) {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(detectTimezone());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [votersPerAssociation, setVotersPerAssociation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const tzOptions = commonTimezones();

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = {
        name,
        start: start ? zonedWallTimeToUTCISO(start, timezone) : '',
        end: end ? zonedWallTimeToUTCISO(end, timezone) : '',
        timezone,
      };
      if (isFederation && votersPerAssociation !== '') {
        payload.votersPerAssociation = Number(votersPerAssociation);
      }
      const res = await apiClient.post('/elections', payload);
      onSuccess(res.election);
    } catch (err) {
      const msg = err.body?.errors ? err.body.errors.join(', ') : (err.message || 'Erreur');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      <Field label="Nom de l'élection" htmlFor="elname">
        <Input
          id="elname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Ex: Élection du bureau 2025"
        />
      </Field>
      <Field
        label="Fuseau horaire"
        htmlFor="eltz"
        hint="Les heures sont enregistrées dans ce fuseau horaire. Chaque utilisateur verra l'heure convertie à son propre fuseau."
      >
        <select
          id="eltz"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          style={{
            padding: '0.65rem 0.85rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.95rem',
            width: '100%',
            background: '#fff',
          }}
        >
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Début de la période de gestion" htmlFor="elstart">
        <Input
          id="elstart"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
        />
      </Field>
      <Field
        label="Fin de la période de gestion"
        htmlFor="elend"
        hint="Les fenêtres de vote sont définies par poste. Cette période contrôle quand vous pouvez configurer l'élection et ajouter des participants."
      >
        <Input
          id="elend"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          required
        />
      </Field>
      {isFederation && (
        <Field
          label="Nombre de votants par association"
          htmlFor="elvoters"
          hint="Quota maximum d'électeurs autorisés pour chaque association participante."
        >
          <Input
            id="elvoters"
            type="number"
            min="1"
            step="1"
            value={votersPerAssociation}
            onChange={(e) => setVotersPerAssociation(e.target.value)}
            placeholder="Ex: 5"
          />
        </Field>
      )}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Création...' : "Créer l'élection"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
