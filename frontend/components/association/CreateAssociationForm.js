'use client';
import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { Field, Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Assign a president / manager to an existing registry association.
 *
 * The association itself (name + emblem + logo) is created in the
 * "Paramètres" registry. This form only attaches a president to a
 * registry association that does not yet have a manager. It therefore:
 *  - loads the registry (GET /associations) and keeps the entries where
 *    `has_manager === false`,
 *  - lets the admin pick one and enter the president name + email,
 *  - submits to POST /associations/:id/manager.
 *
 * @param {object} props
 * @param {(association: object) => void} props.onSuccess
 * @param {() => void} props.onCancel
 */
export default function CreateAssociationForm({ onSuccess, onCancel }) {
  const [associations, setAssociations] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [associationId, setAssociationId] = useState('');
  const [presidentName, setPresidentName] = useState('');
  const [presidentEmail, setPresidentEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    apiClient
      .get('/associations')
      .then((data) => {
        if (!active) return;
        const unassigned = (data.associations || []).filter((a) => !a.has_manager);
        setAssociations(unassigned);
        if (unassigned.length > 0) setAssociationId(unassigned[0].id);
      })
      .catch(() => {
        if (active) setError('Erreur lors du chargement des associations');
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!associationId) {
      setError('Veuillez sélectionner une association');
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post(`/associations/${associationId}/manager`, {
        presidentName,
        presidentEmail,
      });
      onSuccess(res.association);
    } catch (err) {
      const msg = err.body?.errors ? err.body.errors.join(', ') : err.body?.error || err.message || 'Erreur';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (loadingList) {
    return <Spinner />;
  }

  if (associations.length === 0) {
    return (
      <div>
        <EmptyState
          icon="🏛️"
          title="Aucune association disponible"
          text="Toutes les associations enregistrées ont déjà un président. Ajoutez une nouvelle association depuis « Paramètres » avant d'assigner un président."
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <Button type="button" variant="outline" onClick={onCancel}>
            Fermer
          </Button>
        </div>
      </div>
    );
  }

  const selected = associations.find((a) => a.id === associationId);

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      <Field
        label="Association"
        hint="Seules les associations sans président sont listées."
        htmlFor="assoc-select"
      >
        <select
          id="assoc-select"
          className="select"
          value={associationId}
          onChange={(e) => setAssociationId(e.target.value)}
          required
          style={{
            width: '100%',
            padding: '0.6rem 0.75rem',
            borderRadius: 'var(--radius-sm, 8px)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: '0.9rem',
          }}
        >
          {associations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.emblem ? ` — ${a.emblem}` : ''}
            </option>
          ))}
        </select>
      </Field>

      {selected && (selected.logo_ref || selected.emblem) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            margin: '0 0 1rem',
            padding: '0.6rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm, 8px)',
            background: 'var(--bg)',
          }}
        >
          {selected.logo_ref && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.logo_ref}
              alt={selected.name}
              style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover' }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <strong style={{ fontSize: '0.85rem' }}>{selected.name}</strong>
            {selected.emblem && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selected.emblem}</span>
            )}
          </div>
        </div>
      )}

      <Field label="Nom du président" htmlFor="pname">
        <Input
          id="pname"
          value={presidentName}
          onChange={(e) => setPresidentName(e.target.value)}
          required
          maxLength={200}
        />
      </Field>
      <Field
        label="Email du président"
        hint="Les identifiants de connexion seront envoyés à cette adresse."
        htmlFor="pemail"
      >
        <Input
          id="pemail"
          type="email"
          value={presidentEmail}
          onChange={(e) => setPresidentEmail(e.target.value)}
          required
          maxLength={254}
        />
      </Field>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Assignation...' : 'Assigner le président'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
