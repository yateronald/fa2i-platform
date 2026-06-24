'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { getCurrentUser } from '@/lib/session';
import { formatDisplayTime } from '@/lib/timezone';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StateBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import EditAssociationForm from '@/components/association/EditAssociationForm';
import AssociationUsersManager from '@/components/association/AssociationUsersManager';
import styles from './detail.module.css';

/**
 * Federation Admin — Association detail with its elections.
 */
export default function AssociationDetailPage({ params }) {
  const { id } = use(params);
  const router = useRouter();

  const [association, setAssociation] = useState(null);
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [assocRes, electionsRes] = await Promise.all([
        apiClient.get(`/associations/${id}`),
        apiClient.get(`/associations/${id}/elections`),
      ]);
      setAssociation(assocRes.association);
      setElections(electionsRes.elections || []);
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (err.status === 403) {
        setError('Accès refusé.');
      } else {
        setError('Erreur lors du chargement de l\'association');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

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
      fetchData();
    }).catch(() => { window.location.href = '/login'; });
    return () => { active = false; };
  }, [router, fetchData]);

  async function handleEditSuccess() {
    setEditing(false);
    await fetchData();
    setSuccess('Association mise à jour.');
  }

  function renderSchedule(election) {
    if (!election.start_at || !election.end_at) return null;
    const start = formatDisplayTime(election.start_at, election.schedule_timezone);
    const end = formatDisplayTime(election.end_at, election.schedule_timezone);
    return (
      <span className={styles.schedule}>
        {start.text} → {end.text} <span className={styles.zone}>({start.zoneLabel})</span>
      </span>
    );
  }

  if (checkingRole) {
    return (
      <Card>
        <Spinner />
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <Spinner />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <Alert>{error}</Alert>
      </Card>
    );
  }

  return (
    <>
      <Card>
        {success && <Alert type="success">{success}</Alert>}
        <div className={styles.header}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.logo}
            src={association?.logo_ref || '/fa2i-logo.jpg'}
            alt={association?.name || 'Association'}
          />
          <div className={styles.headerInfo}>
            <span className={styles.name}>{association?.name}</span>
            <span className={styles.muted}>{association?.president_name}</span>
            <span className={styles.muted}>{association?.president_email}</span>
          </div>
          <div className={styles.headerAction}>
            <Button variant="outline" onClick={() => { setSuccess(''); setEditing(true); }}>
              Modifier
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Élections de l'association" />
        {elections.length === 0 ? (
          <EmptyState
            icon="🗳️"
            title="Aucune élection"
            text="Cette association n'a pas encore d'élections."
          />
        ) : (
          <div className={styles.list}>
            {elections.map((election) => (
              <div key={election.id} className={styles.electionCard}>
                <div className={styles.electionMain}>
                  <div className={styles.electionTop}>
                    <span className={styles.electionName}>{election.name}</span>
                    <StateBadge state={election.state} />
                  </div>
                  {renderSchedule(election)}
                </div>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/elections/${election.id}/dashboard`)}
                >
                  Voir les résultats
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <AssociationUsersManager associationId={id} />

      <Modal open={editing} title="Modifier l'association" onClose={() => setEditing(false)}>
        {association && (
          <EditAssociationForm
            association={association}
            onSuccess={handleEditSuccess}
            onCancel={() => setEditing(false)}
          />
        )}
      </Modal>
    </>
  );
}
