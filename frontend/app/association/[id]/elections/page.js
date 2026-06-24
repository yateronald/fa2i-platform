'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { formatDisplayTime } from '@/lib/timezone';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StateBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Alert } from '@/components/ui/Alert';
import { Modal } from '@/components/ui/Modal';
import CreateElectionForm from '@/components/election/CreateElectionForm';
import styles from './elections.module.css';

/**
 * Association Elections List (Req 6.2, 6.7)
 *
 * Lists the manager's association elections and lets them create a new
 * ASSOCIATION-scope election (scope is derived server-side from the caller).
 */
export default function AssociationElectionsPage({ params }) {
  const { id } = use(params);
  const router = useRouter();

  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const fetchElections = useCallback(async () => {
    try {
      const data = await apiClient.get('/elections');
      setElections(data.elections || []);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (err.status === 403) {
        setError('Accès refusé.');
        return;
      }
      setError('Erreur lors du chargement des élections.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchElections();
  }, [fetchElections]);

  function handleSuccess() {
    setModalOpen(false);
    setLoading(true);
    fetchElections();
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Élections"
          action={<Button onClick={() => setModalOpen(true)}>Nouvelle élection</Button>}
        />

        {loading ? (
          <Spinner label="Chargement des élections..." />
        ) : error ? (
          <Alert>{error}</Alert>
        ) : elections.length === 0 ? (
          <EmptyState
            icon="🗳️"
            title="Aucune élection"
            text="Créez votre première élection pour commencer."
          />
        ) : (
          <div className={styles.list}>
            {elections.map((election) => {
              const startInfo = election.start_at
                ? formatDisplayTime(election.start_at, election.schedule_timezone)
                : null;
              const endInfo = election.end_at
                ? formatDisplayTime(election.end_at, election.schedule_timezone)
                : null;
              return (
                <div key={election.id} className={styles.electionCard}>
                  <div className={styles.electionMain}>
                    <div className={styles.electionTop}>
                      <span className={styles.electionName}>{election.name}</span>
                      <StateBadge state={election.state} />
                    </div>
                    <div className={styles.schedule}>
                      {startInfo && (
                        <span>
                          Ouverture : {startInfo.text}{' '}
                          <span className={styles.zone}>({startInfo.zoneLabel})</span>
                        </span>
                      )}
                      {endInfo && (
                        <span>
                          Clôture : {endInfo.text}{' '}
                          <span className={styles.zone}>({endInfo.zoneLabel})</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => router.push(`/association/${id}/elections/${election.id}`)}>Gérer</Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal open={modalOpen} title="Créer une élection" onClose={() => setModalOpen(false)}>
        <CreateElectionForm onSuccess={handleSuccess} onCancel={() => setModalOpen(false)} />
      </Modal>
    </>
  );
}
