'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { getCurrentUser } from '@/lib/session';
import { readFileAsDataURL } from '@/lib/fileUtils';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import EditAssociationForm from '@/components/association/EditAssociationForm';
import styles from './settings.module.css';

/**
 * Registry creation form (name + emblem + logo, no president).
 * Posts to POST /associations.
 */
function RegistryCreateForm({ onSuccess, onCancel }) {
  const [name, setName] = useState('');
  const [emblem, setEmblem] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = { name, emblem: emblem || null };
      if (logoFile) {
        const { dataUrl } = await readFileAsDataURL(logoFile);
        payload.logo = dataUrl;
      }
      const res = await apiClient.post('/associations', payload);
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
      <Field label="Nom de l'association" htmlFor="rname">
        <Input id="rname" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </Field>
      <Field label="Emblème" hint="Devise ou slogan de l'association (optionnel)." htmlFor="remblem">
        <Input id="remblem" value={emblem} onChange={(e) => setEmblem(e.target.value)} maxLength={500} />
      </Field>
      <Field label="Logo de l'association" hint="Image (logo de l'association)." htmlFor="rlogo">
        <Input
          id="rlogo"
          type="file"
          accept="image/*"
          onChange={(e) => setLogoFile(e.target.files[0])}
        />
      </Field>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Création...' : "Ajouter l'association"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

/**
 * Federation Admin — Paramètres / Registre des associations.
 *
 * Canonical CRUD page for association registry records:
 *  - list all associations (name, emblem, logo, manager badge)
 *  - add a registry association (name + emblem + logo)
 *  - edit a registry association
 *  - delete a registry association (with confirmation + in-use handling)
 */
export default function FederationSettingsPage() {
  const router = useRouter();
  const [associations, setAssociations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);

  const fetchAssociations = useCallback(async () => {
    try {
      const data = await apiClient.get('/associations');
      setAssociations(data.associations || []);
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError('Erreur lors du chargement des associations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((u) => {
        if (!active) return;
        if (!u) {
          window.location.href = '/login';
          return;
        }
        if (u.role !== 'FEDERATION_ADMINISTRATOR') {
          router.replace('/federation');
          return;
        }
        setCheckingRole(false);
        fetchAssociations();
      })
      .catch(() => {
        window.location.href = '/login';
      });
    return () => {
      active = false;
    };
  }, [router, fetchAssociations]);

  async function handleCreateSuccess() {
    setCreateOpen(false);
    await fetchAssociations();
    setSuccess('Association ajoutée au registre.');
  }

  async function handleEditSuccess() {
    setEditing(null);
    await fetchAssociations();
    setSuccess('Association mise à jour.');
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError('');
    setDeleteLoading(true);
    try {
      await apiClient.delete(`/associations/${deleting.id}`);
      setDeleting(null);
      await fetchAssociations();
      setSuccess('Association supprimée.');
    } catch (err) {
      setDeleteError(err.body?.error || err.message || 'Erreur lors de la suppression');
    } finally {
      setDeleteLoading(false);
    }
  }

  if (checkingRole) {
    return <Spinner />;
  }

  return (
    <div>
      <Card>
        <CardHeader
          title="Registre des associations"
          subtitle={
            associations.length > 0
              ? `${associations.length} association${associations.length > 1 ? 's' : ''} enregistrée${associations.length > 1 ? 's' : ''}`
              : 'Gérez le registre central des associations'
          }
          action={
            <Button onClick={() => { setSuccess(''); setCreateOpen(true); }}>
              + Ajouter une association
            </Button>
          }
        />

        {success && <Alert type="success">{success}</Alert>}
        {error && <Alert>{error}</Alert>}

        {loading ? (
          <Spinner />
        ) : associations.length === 0 ? (
          <EmptyState
            icon="🏛️"
            title="Registre vide"
            text="Ajoutez une première association pour commencer."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Logo</th>
                  <th>Nom</th>
                  <th>Emblème</th>
                  <th>Président</th>
                  <th className={styles.actionsCol}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {associations.map((assoc) => (
                  <tr key={assoc.id}>
                    <td>
                      {assoc.logo_ref ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={styles.logoThumb} src={assoc.logo_ref} alt={assoc.name} />
                      ) : (
                        <div className={styles.logoPlaceholder} aria-hidden="true">
                          {assoc.name?.charAt(0) || '?'}
                        </div>
                      )}
                    </td>
                    <td className={styles.nameCell}>{assoc.name}</td>
                    <td className={styles.emblemCell}>
                      {assoc.emblem ? assoc.emblem : <span className={styles.muted}>—</span>}
                    </td>
                    <td>
                      {assoc.has_manager ? (
                        <Badge variant="open">● Assigné</Badge>
                      ) : (
                        <Badge variant="warn">Aucun</Badge>
                      )}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <Button
                          className={styles.smallBtn}
                          variant="outline"
                          onClick={() => { setSuccess(''); setEditing(assoc); }}
                        >
                          Modifier
                        </Button>
                        <Button
                          className={styles.smallBtn}
                          variant="danger"
                          onClick={() => { setSuccess(''); setDeleteError(''); setDeleting(assoc); }}
                        >
                          Supprimer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={createOpen} title="Ajouter une association" onClose={() => setCreateOpen(false)}>
        <RegistryCreateForm onSuccess={handleCreateSuccess} onCancel={() => setCreateOpen(false)} />
      </Modal>

      <Modal open={!!editing} title="Modifier l'association" onClose={() => setEditing(null)}>
        {editing && (
          <EditAssociationForm
            association={editing}
            onSuccess={handleEditSuccess}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal open={!!deleting} title="Supprimer l'association" onClose={() => setDeleting(null)}>
        {deleting && (
          <div>
            {deleteError && <Alert>{deleteError}</Alert>}
            <p className={styles.confirmText}>
              Voulez-vous vraiment supprimer <strong>{deleting.name}</strong> du registre ? Cette
              action est irréversible.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
              <Button variant="danger" onClick={confirmDelete} disabled={deleteLoading}>
                {deleteLoading ? 'Suppression...' : 'Supprimer'}
              </Button>
              <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteLoading}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
