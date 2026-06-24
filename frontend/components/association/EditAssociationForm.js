'use client';
import { useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { readFileAsDataURL } from '@/lib/fileUtils';
import { Field, Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';

/**
 * Edit an existing registry association.
 *
 * The name and emblem are registry fields. The logo is optional (leave empty
 * to keep the current one). President name/email are optional — a registry
 * association may not have a president assigned yet, so these fields can be
 * empty.
 *
 * @param {object} props
 * @param {{ id: string, name: string, emblem?: string, president_name?: string, president_email?: string, logo_ref?: string }} props.association
 * @param {(updated: object) => void} props.onSuccess
 * @param {() => void} props.onCancel
 */
export default function EditAssociationForm({ association, onSuccess, onCancel }) {
  const [name, setName] = useState(association.name || '');
  const [emblem, setEmblem] = useState(association.emblem || '');
  const [presidentName, setPresidentName] = useState(association.president_name || '');
  const [presidentEmail, setPresidentEmail] = useState(association.president_email || '');
  const [logoFile, setLogoFile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = {
        name,
        emblem: emblem || null,
        presidentName: presidentName || undefined,
        presidentEmail: presidentEmail || undefined,
      };
      if (logoFile) {
        const { dataUrl } = await readFileAsDataURL(logoFile);
        payload.logo = dataUrl;
      }
      const res = await apiClient.patch(`/associations/${association.id}`, payload);
      onSuccess(res.association);
    } catch (err) {
      const msg = err.body?.errors ? err.body.errors.join(', ') : err.body?.error || err.message || 'Erreur';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      <Field label="Nom de l'association" htmlFor="ename">
        <Input
          id="ename"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
        />
      </Field>
      <Field label="Emblème" hint="Devise ou slogan de l'association (optionnel)." htmlFor="eemblem">
        <Input
          id="eemblem"
          value={emblem}
          onChange={(e) => setEmblem(e.target.value)}
          maxLength={500}
        />
      </Field>
      <Field label="Nom du président (optionnel)" htmlFor="epname">
        <Input
          id="epname"
          value={presidentName}
          onChange={(e) => setPresidentName(e.target.value)}
          maxLength={200}
        />
      </Field>
      <Field label="Email du président (optionnel)" htmlFor="epemail">
        <Input
          id="epemail"
          type="email"
          value={presidentEmail}
          onChange={(e) => setPresidentEmail(e.target.value)}
          maxLength={254}
        />
      </Field>
      <Field label="Logo (laisser vide pour conserver l'actuel)" htmlFor="elogo">
        {association.logo_ref && (
          <div style={{ marginBottom: '0.5rem' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={association.logo_ref}
              alt={association.name}
              style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
            />
          </div>
        )}
        <Input
          id="elogo"
          type="file"
          accept="image/*"
          onChange={(e) => setLogoFile(e.target.files[0])}
        />
      </Field>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Enregistrement...' : 'Enregistrer'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
