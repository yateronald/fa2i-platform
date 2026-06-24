'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { getCurrentUser } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import CreateUserForm from '@/components/user/CreateUserForm';
import styles from './users.module.css';

/**
 * Federation Admin — User management.
 *
 * Lists federation users and lets a full administrator create, enable/disable,
 * change roles and delete them. Election managers are redirected away.
 */
export default function FederationUsersPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingRole, setCheckingRole] = useState(true);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/users');
      setUsers(data.users || []);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError('Erreur lors du chargement des utilisateurs');
    } finally {
      setLoading(false);
    }
  }, []);

  // Guard: only full administrators may access this page.
  useEffect(() => {
    let active = true;
    getCurrentUser().then((u) => {
      if (!active) return;
      if (!u) {
        window.location.href = '/login';
        return;
      }
      if (u.role !== 'FEDERATION_ADMINISTRATOR') {
        router.replace('/federation');
        return;
      }
      setCurrentUser(u);
      setCheckingRole(false);
      fetchUsers();
    }).catch(() => { window.location.href = '/login'; });
    return () => { active = false; };
  }, [router, fetchUsers]);

  async function handleCreateSuccess() {
    setModalOpen(false);
    await fetchUsers();
    setSuccess('Utilisateur créé. Un mot de passe temporaire a été envoyé par email.');
  }

  async function handleToggleActive(u) {
    setSuccess('');
    setError('');
    try {
      await apiClient.patch(`/users/${u.id}`, { isActive: !u.is_active });
      await fetchUsers();
    } catch (err) {
      setError(err.body?.error || err.message || 'Erreur lors de la mise à jour');
    }
  }

  async function handleDelete(u) {
    if (!window.confirm('Supprimer cet utilisateur ?')) return;
    setSuccess('');
    setError('');
    try {
      await apiClient.delete(`/users/${u.id}`);
      await fetchUsers();
      setSuccess('Utilisateur supprimé.');
    } catch (err) {
      setError(err.body?.error || err.message || 'Erreur lors de la suppression');
    }
  }

  function roleBadge(role) {
    if (role === 'FEDERATION_ADMINISTRATOR') {
      return <Badge variant="open">Administrateur</Badge>;
    }
    return <Badge variant="neutral">Gestionnaire d&apos;élections</Badge>;
  }

  if (checkingRole) {
    return <Spinner />;
  }

  // Calculate quick stats for sidebar
  const totalUsers = users.length;
  const adminCount = users.filter(u => u.role === 'FEDERATION_ADMINISTRATOR').length;
  const managerCount = users.filter(u => u.role === 'FEDERATION_ELECTION_MANAGER').length;
  const activeCount = users.filter(u => u.is_active).length;

  return (
    <div className={styles.pageGrid}>
      {/* Main card */}
      <Card>
        <CardHeader
          title="Utilisateurs de la fédération"
          subtitle={users.length > 0 ? `${users.length} utilisateur${users.length > 1 ? 's' : ''}` : undefined}
          action={<Button onClick={() => { setSuccess(''); setError(''); setModalOpen(true); }}>+ Nouvel utilisateur</Button>}
        />

        {success && <Alert type="success">{success}</Alert>}
        {error && <Alert>{error}</Alert>}

        {loading ? (
          <Spinner />
        ) : users.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Aucun utilisateur"
            text="Créez un premier utilisateur pour la fédération."
          />
        ) : (
          <div className={styles.list}>
            {users.map((u) => {
              const isSelf = currentUser && u.id === currentUser.id;
              return (
                <div key={u.id} className={styles.row}>
                  <div className={styles.userInfo}>
                    <span className={styles.email}>{u.email}</span>
                    <div className={styles.badges}>
                      {roleBadge(u.role)}
                      {u.is_active ? (
                        <Badge variant="open">Actif</Badge>
                      ) : (
                        <Badge variant="closed">Désactivé</Badge>
                      )}
                    </div>
                  </div>
                  <div className={styles.actions}>
                    {isSelf ? (
                      <span className={styles.selfLabel}>Vous</span>
                    ) : (
                      <>
                        <Button variant="outline" onClick={() => handleToggleActive(u)}>
                          {u.is_active ? 'Désactiver' : 'Activer'}
                        </Button>
                        <Button variant="danger" onClick={() => handleDelete(u)}>
                          Supprimer
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Sidebar stats/guides */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarCard}>
          <div className={styles.sidebarTitle}>Statistiques d&apos;accès</div>
          <div className={styles.sidebarStats}>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>Total Utilisateurs</span>
              <span className={styles.statVal}>{totalUsers}</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>Administrateurs</span>
              <span className={styles.statVal}>{adminCount}</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>Gestionnaires d&apos;élections</span>
              <span className={styles.statVal}>{managerCount}</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>Comptes Actifs</span>
              <span className={styles.statVal}>{activeCount}</span>
            </div>
          </div>
        </div>

        <div className={styles.sidebarCard}>
          <div className={styles.sidebarTitle}>Guides &amp; Rôles</div>
          <div className={styles.guideBox}>
            <div className={styles.guideItem}>
              <span className={styles.guideIcon}>✦</span>
              <span><strong>Administrateur :</strong> Accès total à la gestion des associations, des élections et des utilisateurs.</span>
            </div>
            <div className={styles.guideItem}>
              <span className={styles.guideIcon}>✦</span>
              <span><strong>Gestionnaire :</strong> Accès uniquement à la création et à la gestion des élections qui lui sont assignées.</span>
            </div>
            <div className={styles.guideItem}>
              <span className={styles.guideIcon}>✦</span>
              <span>Lors de la création d&apos;un compte, un mot de passe temporaire est automatiquement envoyé par e-mail.</span>
            </div>
          </div>
        </div>
      </div>

      <Modal open={modalOpen} title="Créer un utilisateur" onClose={() => setModalOpen(false)}>
        <CreateUserForm
          onSuccess={handleCreateSuccess}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
