'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/apiClient';
import { getCurrentUser } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './AssociationUsersManager.module.css';

const ROLE_OPTIONS = [
  { value: 'ASSOCIATION_MANAGER', label: 'Contrôle total' },
  { value: 'ASSOCIATION_ELECTION_MANAGER', label: 'Gestion des élections' },
];

const selectStyle = {
  padding: '0.65rem 0.85rem',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.95rem',
  width: '100%',
};

function roleLabel(role) {
  return role === 'ASSOCIATION_MANAGER' ? 'Contrôle total' : 'Gestion des élections';
}

/**
 * Shared "Utilisateurs de l'association" management UI.
 *
 * Lists the sub-users of a given association and lets an authorized caller
 * create, edit (role / federation-voter permission), enable/disable and
 * delete them. The backend scopes every operation: an association manager is
 * forced to their own association (the associationId param is ignored for
 * them), while a federation administrator targets the supplied associationId.
 * The client mirrors the self-protection rules for a smoother UX but always
 * defers to the server.
 *
 * @param {object} props
 * @param {string} props.associationId - the association whose users to manage (required)
 */
export default function AssociationUsersManager({ associationId }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [cFullName, setCFullName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cRole, setCRole] = useState('ASSOCIATION_MANAGER');
  const [cCanAdd, setCCanAdd] = useState(false);
  const [cCanManage, setCCanManage] = useState(false);
  const [cError, setCError] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit modal state
  const [editUser, setEditUser] = useState(null);
  const [eRole, setERole] = useState('ASSOCIATION_MANAGER');
  const [eCanAdd, setECanAdd] = useState(false);
  const [eCanManage, setECanManage] = useState(false);
  const [eError, setEError] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete confirm state
  const [deleteUser, setDeleteUser] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [dError, setDError] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get(`/association-users?associationId=${associationId}`);
      setUsers(data.users || []);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError('Erreur lors du chargement des utilisateurs.');
    } finally {
      setLoading(false);
    }
  }, [associationId]);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((u) => {
        if (!active) return;
        if (!u) {
          window.location.href = '/login';
          return;
        }
        setCurrentUser(u);
        fetchUsers();
      })
      .catch(() => {
        window.location.href = '/login';
      });
    return () => {
      active = false;
    };
  }, [fetchUsers]);

  /* ── Create ──────────────────────────────────────────────── */
  function openCreate() {
    setCFullName('');
    setCEmail('');
    setCRole('ASSOCIATION_MANAGER');
    setCCanAdd(false);
    setCCanManage(false);
    setCError('');
    setSuccess('');
    setError('');
    setCreateOpen(true);
  }

  function handleCreateRoleChange(value) {
    setCRole(value);
    // Federation-voter and member-management permissions only apply to election managers.
    if (value !== 'ASSOCIATION_ELECTION_MANAGER') {
      setCCanAdd(false);
      setCCanManage(false);
    }
  }

  async function submitCreate(e) {
    e.preventDefault();
    setCError('');
    if (!cFullName.trim() || !cEmail.trim()) {
      setCError('Le nom complet et l’email sont requis.');
      return;
    }
    setCreating(true);
    try {
      await apiClient.post('/association-users', {
        email: cEmail.trim(),
        fullName: cFullName.trim(),
        role: cRole,
        canAddFederationVoters: cRole === 'ASSOCIATION_ELECTION_MANAGER' ? cCanAdd : false,
        canManageMembers: cRole === 'ASSOCIATION_ELECTION_MANAGER' ? cCanManage : false,
        associationId,
      });
      setCreateOpen(false);
      await fetchUsers();
      setSuccess('Utilisateur créé. Un mot de passe temporaire a été envoyé par email.');
    } catch (err) {
      if (err.status === 409) {
        setCError(err.body?.error || 'Cet email est déjà utilisé.');
      } else if (err.body?.errors) {
        setCError(err.body.errors.join(', '));
      } else {
        setCError(err.body?.error || err.message || 'Échec de la création de l’utilisateur.');
      }
    } finally {
      setCreating(false);
    }
  }

  /* ── Edit ────────────────────────────────────────────────── */
  function openEdit(u) {
    setEditUser(u);
    setERole(u.role);
    setECanAdd(!!u.can_add_federation_voters);
    setECanManage(!!u.can_manage_members);
    setEError('');
    setSuccess('');
    setError('');
  }

  function handleEditRoleChange(value) {
    setERole(value);
    if (value !== 'ASSOCIATION_ELECTION_MANAGER') {
      setECanAdd(false);
      setECanManage(false);
    }
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editUser) return;
    setEError('');
    setSaving(true);
    try {
      await apiClient.patch(`/association-users/${editUser.id}`, {
        role: eRole,
        canAddFederationVoters: eRole === 'ASSOCIATION_ELECTION_MANAGER' ? eCanAdd : false,
        canManageMembers: eRole === 'ASSOCIATION_ELECTION_MANAGER' ? eCanManage : false,
      });
      setEditUser(null);
      await fetchUsers();
      setSuccess('Utilisateur mis à jour.');
    } catch (err) {
      setEError(err.body?.error || err.message || 'Échec de la mise à jour.');
    } finally {
      setSaving(false);
    }
  }

  /* ── Toggle active ───────────────────────────────────────── */
  async function handleToggleActive(u) {
    setSuccess('');
    setError('');
    try {
      await apiClient.patch(`/association-users/${u.id}`, { isActive: !u.is_active });
      await fetchUsers();
    } catch (err) {
      setError(err.body?.error || err.message || 'Erreur lors de la mise à jour.');
    }
  }

  /* ── Delete ──────────────────────────────────────────────── */
  async function confirmDelete() {
    if (!deleteUser) return;
    setDError('');
    setDeleting(true);
    try {
      await apiClient.delete(`/association-users/${deleteUser.id}`);
      setDeleteUser(null);
      await fetchUsers();
      setSuccess('Utilisateur supprimé.');
    } catch (err) {
      setDError(err.body?.error || err.message || 'Erreur lors de la suppression.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.page}>
      <Card>
        <CardHeader
          title="Utilisateurs de l’association"
          subtitle={
            users.length > 0
              ? `${users.length} utilisateur${users.length > 1 ? 's' : ''}`
              : "Gérez les gestionnaires de cette association."
          }
          action={<Button onClick={openCreate}>+ Ajouter un utilisateur</Button>}
        />

        {success && <Alert type="success">{success}</Alert>}
        {error && <Alert>{error}</Alert>}

        {loading ? (
          <Spinner label="Chargement des utilisateurs..." />
        ) : users.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Aucun utilisateur"
            text="Ajoutez un premier utilisateur pour gérer cette association."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Nom complet</th>
                  <th>Email</th>
                  <th>Rôle</th>
                  <th>Statut</th>
                  <th className={styles.actionsCol}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = currentUser && u.id === currentUser.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <span className={styles.name}>{u.full_name || '—'}</span>
                        {u.is_temporary_password && (
                          <span className={styles.tempPwd} title="Mot de passe temporaire non encore changé">
                            Mot de passe temporaire
                          </span>
                        )}
                      </td>
                      <td className={styles.emailCell}>{u.email}</td>
                      <td>
                        <div className={styles.badges}>
                          <Badge variant={u.role === 'ASSOCIATION_MANAGER' ? 'open' : 'neutral'}>
                            {roleLabel(u.role)}
                          </Badge>
                          {u.can_add_federation_voters && (
                            <Badge variant="warn">Électeurs fédération</Badge>
                          )}
                          {u.can_manage_members && (
                            <Badge variant="warn">Membres</Badge>
                          )}
                        </div>
                      </td>
                      <td>
                        {u.is_active ? (
                          <Badge variant="open">Actif</Badge>
                        ) : (
                          <Badge variant="closed">Désactivé</Badge>
                        )}
                      </td>
                      <td>
                        <div className={styles.actions}>
                          {isSelf ? (
                            <span className={styles.selfLabel}>Vous</span>
                          ) : (
                            <>
                              <Button variant="outline" onClick={() => openEdit(u)}>
                                Modifier
                              </Button>
                              <Button variant="outline" onClick={() => handleToggleActive(u)}>
                                {u.is_active ? 'Désactiver' : 'Activer'}
                              </Button>
                              <Button variant="danger" onClick={() => { setDError(''); setDeleteUser(u); }}>
                                Supprimer
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create modal */}
      <Modal open={createOpen} title="Ajouter un utilisateur" onClose={() => setCreateOpen(false)}>
        <form onSubmit={submitCreate} className={styles.form}>
          {cError && <Alert>{cError}</Alert>}
          <Field label="Nom complet" htmlFor="cu-fullname">
            <Input
              id="cu-fullname"
              value={cFullName}
              onChange={(e) => setCFullName(e.target.value)}
              placeholder="Ex. Awa Diop"
              required
              maxLength={120}
            />
          </Field>
          <Field
            label="Email"
            hint="Un mot de passe temporaire sera envoyé à cette adresse."
            htmlFor="cu-email"
          >
            <Input
              id="cu-email"
              type="email"
              value={cEmail}
              onChange={(e) => setCEmail(e.target.value)}
              placeholder="exemple@domaine.com"
              required
              maxLength={254}
            />
          </Field>
          <Field label="Rôle" htmlFor="cu-role">
            <select
              id="cu-role"
              value={cRole}
              onChange={(e) => handleCreateRoleChange(e.target.value)}
              style={selectStyle}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          {cRole === 'ASSOCIATION_ELECTION_MANAGER' && (
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={cCanAdd}
                onChange={(e) => setCCanAdd(e.target.checked)}
              />
              <span>Peut ajouter des électeurs pour la fédération</span>
            </label>
          )}
          {cRole === 'ASSOCIATION_ELECTION_MANAGER' && (
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={cCanManage}
                onChange={(e) => setCCanManage(e.target.checked)}
              />
              <span>Peut gérer les membres</span>
            </label>
          )}
          <div className={styles.formActions}>
            <Button type="submit" disabled={creating}>
              {creating ? 'Création...' : "Créer l'utilisateur"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editUser} title="Modifier l’utilisateur" onClose={() => setEditUser(null)}>
        {editUser && (
          <form onSubmit={submitEdit} className={styles.form}>
            {eError && <Alert>{eError}</Alert>}
            <p className={styles.editTarget}>
              {editUser.full_name} <span className={styles.muted}>({editUser.email})</span>
            </p>
            <Field label="Rôle" htmlFor="eu-role">
              <select
                id="eu-role"
                value={eRole}
                onChange={(e) => handleEditRoleChange(e.target.value)}
                style={selectStyle}
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
            {eRole === 'ASSOCIATION_ELECTION_MANAGER' && (
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={eCanAdd}
                  onChange={(e) => setECanAdd(e.target.checked)}
                />
                <span>Peut ajouter des électeurs pour la fédération</span>
              </label>
            )}
            {eRole === 'ASSOCIATION_ELECTION_MANAGER' && (
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={eCanManage}
                  onChange={(e) => setECanManage(e.target.checked)}
                />
                <span>Peut gérer les membres</span>
              </label>
            )}
            <div className={styles.formActions}>
              <Button type="submit" disabled={saving}>
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                Annuler
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={!!deleteUser} title="Supprimer l’utilisateur" onClose={() => setDeleteUser(null)}>
        {deleteUser && (
          <div className={styles.form}>
            {dError && <Alert>{dError}</Alert>}
            <p>
              Êtes-vous sûr de vouloir supprimer{' '}
              <strong>{deleteUser.full_name || deleteUser.email}</strong> ? Cette action est
              irréversible.
            </p>
            <div className={styles.formActions}>
              <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Suppression...' : 'Supprimer'}
              </Button>
              <Button variant="outline" onClick={() => setDeleteUser(null)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
