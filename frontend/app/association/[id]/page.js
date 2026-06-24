'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StateBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Alert } from '@/components/ui/Alert';
import styles from './association.module.css';

const FALLBACK_LOGO = '/fa2i-logo.jpg';

/**
 * Association Manager Dashboard (Req 6.2, 6.7, 20.4)
 *
 * Shows the manager an overview of their association: branding header,
 * election stats, and the most recent elections with a link to the full list.
 */
export default function AssociationDashboardPage({ params }) {
  const { id } = use(params);
  const router = useRouter();

  const [association, setAssociation] = useState(null);
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function fetchData() {
      try {
        const [assocData, electionData] = await Promise.all([
          apiClient.get(`/associations/${id}`),
          apiClient.get('/elections'),
        ]);
        if (!active) return;
        setAssociation(assocData.association || null);
        setElections(electionData.elections || []);
      } catch (err) {
        if (!active) return;
        if (err.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (err.status === 403) {
          setError('Accès refusé.');
          return;
        }
        setError('Erreur lors du chargement des données.');
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchData();
    return () => {
      active = false;
    };
  }, [id]);

  const openCount = elections.filter((e) => e.state === 'OPEN').length;
  const recentElections = elections.slice(0, 5);
  const logoUrl = association?.logo_ref || FALLBACK_LOGO;

  return (
    <>
      {loading ? (
        <Spinner label="Chargement du tableau de bord..." />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : (
        <div className={styles.dashboard}>
          {/* Header card */}
          <Card>
            <div className={styles.header}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt={association?.name || 'Association'}
                className={styles.logo}
                onError={(e) => {
                  if (e.currentTarget.src !== window.location.origin + FALLBACK_LOGO) {
                    e.currentTarget.src = FALLBACK_LOGO;
                  }
                }}
              />
              <div className={styles.headerText}>
                <h2 className={styles.assocName}>{association?.name || 'Association'}</h2>
                {association?.president_name && (
                  <p className={styles.president}>Président : {association.president_name}</p>
                )}
              </div>
            </div>
          </Card>

          {/* Stat cards */}
          <div className={styles.statGrid}>
            <Card className={styles.statCard}>
              <span className={styles.statValue}>{elections.length}</span>
              <span className={styles.statLabel}>Élections au total</span>
            </Card>
            <Card className={styles.statCard}>
              <span className={styles.statValue}>{openCount}</span>
              <span className={styles.statLabel}>Élections ouvertes</span>
            </Card>
          </div>

          {/* Recent elections */}
          <Card>
            <CardHeader
              title="Élections récentes"
              action={
                <Button variant="outline" onClick={() => router.push(`/association/${id}/elections`)}>Voir tout</Button>
              }
            />
            {recentElections.length === 0 ? (
              <EmptyState
                icon="🗳️"
                title="Aucune élection"
                text="Aucune élection n'a encore été créée pour cette association."
              />
            ) : (
              <ul className={styles.electionList}>
                {recentElections.map((election) => (
                  <li key={election.id} className={styles.electionRow}>
                    <span className={styles.electionName}>{election.name}</span>
                    <StateBadge state={election.state} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
