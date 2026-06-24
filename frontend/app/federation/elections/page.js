'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { formatDisplayTime } from '@/lib/timezone';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StateBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import CreateElectionForm from '@/components/election/CreateElectionForm';
import styles from './elections.module.css';

/**
 * Federation Admin — Federation elections list.
 *
 * Lists federation elections and lets the admin create new ones.
 */
export default function FederationElectionsPage() {
  const router = useRouter();
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const fetchElections = useCallback(async () => {
    try {
      const data = await apiClient.get('/elections');
      setElections(data.elections || []);
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError('Erreur lors du chargement des élections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchElections();
  }, [fetchElections]);

  async function handleSuccess() {
    setModalOpen(false);
    await fetchElections();
  }

  function renderSchedule(election) {
    if (!election.start_at || !election.end_at) return null;
    const start = formatDisplayTime(election.start_at, election.schedule_timezone);
    const end = formatDisplayTime(election.end_at, election.schedule_timezone);
    return (
      <span className={styles.schedule}>
        📅 {start.text} → {end.text} <span className={styles.zone}>({start.zoneLabel})</span>
      </span>
    );
  }

  if (loading) {
    return <Spinner />;
  }

  // Calculate quick stats for sidebar
  const totalElections = elections.length;
  const openCount = elections.filter(e => e.state === 'OPEN').length;
  const prepCount = elections.filter(e => e.state === 'PREPARATION').length;
  const closedCount = elections.filter(e => e.state === 'CLOSED').length;

  return (
    <div className={styles.pageGrid}>
      {/* Main card */}
      <Card>
        <CardHeader
          title="Toutes les élections fédérales"
          subtitle={elections.length > 0 ? `${elections.length} élection${elections.length > 1 ? 's' : ''} créée${elections.length > 1 ? 's' : ''}` : undefined}
          action={<Button onClick={() => setModalOpen(true)}>+ Nouvelle élection</Button>}
        />

        {error && <Alert>{error}</Alert>}

        {elections.length === 0 ? (
          <EmptyState
            icon="🗳️"
            title="Aucune élection"
            text="Créez une première élection fédérale."
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
                <Button variant="outline" onClick={() => router.push(`/federation/elections/${election.id}`)}>Gérer</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Sidebar stats/guides */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarCard}>
          <div className={styles.sidebarTitle}>Statistiques Électorales</div>
          <div className={styles.sidebarStats}>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>Total Élections</span>
              <span className={styles.statVal}>{totalElections}</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>Ouvertes</span>
              <span className={styles.statVal}>{openCount}</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>En Préparation</span>
              <span className={styles.statVal}>{prepCount}</span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.statLabel}>Clôturées</span>
              <span className={styles.statVal}>{closedCount}</span>
            </div>
          </div>
        </div>

        <div className={styles.sidebarCard}>
          <div className={styles.sidebarTitle}>Cycle de vie d&apos;une élection</div>
          <div className={styles.guideBox}>
            <div className={styles.guideItem}>
              <span className={styles.guideIcon}>✦</span>
              <span><strong>Préparation :</strong> Vous configurez les postes de candidature, ajoutez des candidats et déterminez les règles de vote.</span>
            </div>
            <div className={styles.guideItem}>
              <span className={styles.guideIcon}>✦</span>
              <span><strong>Ouverte :</strong> La période de vote a commencé. Les électeurs autorisés peuvent soumettre leur bulletin.</span>
            </div>
            <div className={styles.guideItem}>
              <span className={styles.guideIcon}>✦</span>
              <span><strong>Clôturée :</strong> Le scrutin est clos. Les résultats en direct et les graphiques de distribution sont disponibles pour consultation.</span>
            </div>
          </div>
        </div>
      </div>

      <Modal open={modalOpen} title="Créer une élection fédérale" onClose={() => setModalOpen(false)}>
        <CreateElectionForm
          isFederation
          onSuccess={handleSuccess}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
