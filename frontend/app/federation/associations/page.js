'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { getCurrentUser } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import CreateAssociationForm from '@/components/association/CreateAssociationForm';
import EditAssociationForm from '@/components/association/EditAssociationForm';
import styles from './associations.module.css';

/**
 * Federation Admin — Associations management.
 *
 * Lists associations and lets the federation admin create new ones.
 */
export default function FederationAssociationsPage() {
  const router = useRouter();
  const [associations, setAssociations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
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
    getCurrentUser().then((u) => {
      if (!active) return;
      if (!u) { window.location.href = '/login'; return; }
      if (u.role !== 'FEDERATION_ADMINISTRATOR') {
        router.replace('/federation');
        return;
      }
      setCheckingRole(false);
      fetchAssociations();
    }).catch(() => { window.location.href = '/login'; });
    return () => { active = false; };
  }, [router, fetchAssociations]);

  async function handleSuccess() {
    setModalOpen(false);
    await fetchAssociations();
    setSuccess('Président assigné. Les identifiants ont été envoyés par email.');
  }

  async function handleEditSuccess() {
    setEditing(null);
    await fetchAssociations();
    setSuccess('Association mise à jour.');
  }

  if (checkingRole) {
    return <Spinner />;
  }

  // Calculate quick stats for sidebar
  const totalAssocs = associations.length;
  const assocsWithLogo = associations.filter(a => a.logo_ref).length;
  const logoPercentage = totalAssocs > 0 ? Math.round((assocsWithLogo / totalAssocs) * 100) : 0;

  return (
    <div className={styles.pageGrid}>
      {/* Main card */}
      <Card>
        <CardHeader
          title="Toutes les associations"
          subtitle={associations.length > 0 ? `${associations.length} association${associations.length > 1 ? 's' : ''} enregistrée${associations.length > 1 ? 's' : ''}` : undefined}
          action={<Button onClick={() => { setSuccess(''); setModalOpen(true); }}>+ Assigner un président</Button>}
        />

        {success && <Alert type="success">{success}</Alert>}
        {error && <Alert>{error}</Alert>}

        {loading ? (
          <Spinner />
        ) : associations.length === 0 ? (
          <EmptyState
            icon="🏛️"
            title="Aucune association"
            text="Ajoutez des associations depuis « Paramètres », puis assignez-leur un président ici."
          />
        ) : (
          <div className={styles.grid}>
            {associations.map((assoc) => (
              <div key={assoc.id} className={styles.assocCard}>
                {assoc.logo_ref ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.logo} src={assoc.logo_ref} alt={assoc.name} />
                ) : (
                  <div className={styles.logoPlaceholder} aria-hidden="true">
                    {assoc.name?.charAt(0) || '?'}
                  </div>
                )}
                <div className={styles.assocName} title={assoc.name}>{assoc.name}</div>
                <div className={styles.assocDivider} />
                {assoc.has_manager ? (
                  <>
                    <div className={styles.president}>{assoc.president_name}</div>
                    <div className={styles.email} title={assoc.president_email}>{assoc.president_email}</div>
                  </>
                ) : (
                  <div className={styles.president} style={{ fontStyle: 'italic' }}>Aucun président assigné</div>
                )}
                <div className={styles.assocActions}>
                  <Button
                    className={styles.smallBtn}
                    onClick={() => router.push(`/federation/associations/${assoc.id}`)}
                  >
                    Voir les élections
                  </Button>
                  <Button
                    className={styles.smallBtn}
                    variant="outline"
                    onClick={() => { setSuccess(''); setEditing(assoc); }}
                  >
                    Modifier
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Sidebar stats/guides */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarCard}>
          <div className={styles.sidebarTitle}>Statistiques générales</div>
          <div className={styles.sidebarStats}>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>Total Associations</span>
              <span className={styles.statVal}>{totalAssocs}</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>Avec Logo</span>
              <span className={styles.statVal}>{assocsWithLogo} ({logoPercentage}%)</span>
            </div>
          </div>
        </div>

        <div className={styles.sidebarCard}>
          <div className={styles.sidebarTitle}>Registre &amp; Présidents</div>
          <div className={styles.guideBox}>
            <div className={styles.guideItem}>
              <span className={styles.guideIcon}>✦</span>
              <span><strong>Registre :</strong> Ajoutez et gérez les associations (nom, emblème, logo) depuis la page « Paramètres ».</span>
            </div>
            <div className={styles.guideItem}>
              <span className={styles.guideIcon}>✦</span>
              <span><strong>Présidents :</strong> Assignez un président à une association sans gestionnaire. Il reçoit instantanément ses accès de connexion.</span>
            </div>
            <div className={styles.guideItem}>
              <span className={styles.guideIcon}>✦</span>
              <span><strong>Détails :</strong> Cliquez sur &quot;Voir les élections&quot; pour superviser les élections d&apos;une association en particulier.</span>
            </div>
          </div>
        </div>
      </div>

      <Modal open={modalOpen} title="Assigner un président" onClose={() => setModalOpen(false)}>
        <CreateAssociationForm
          onSuccess={handleSuccess}
          onCancel={() => setModalOpen(false)}
        />
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
    </div>
  );
}
