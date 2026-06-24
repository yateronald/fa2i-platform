'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { getCurrentUser } from '@/lib/session';
import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/Card';
import { StateBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import styles from './federation.module.css';

/**
 * Federation Dashboard.
 *
 * Full administrators see associations + elections stats and panels.
 * Election managers see only election-related stats and the recent
 * elections panel.
 */
export default function FederationPage() {
  const [associations, setAssociations] = useState([]);
  const [elections, setElections] = useState([]);
  const [isFullAdmin, setIsFullAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const user = await getCurrentUser();
        if (!user) {
          window.location.href = '/login';
          return;
        }
        const fullAdmin = user.role === 'FEDERATION_ADMINISTRATOR';
        setIsFullAdmin(fullAdmin);

        const requests = [apiClient.get('/elections')];
        if (fullAdmin) {
          requests.unshift(apiClient.get('/associations'));
        }
        const results = await Promise.all(requests);

        if (fullAdmin) {
          const [assocData, electionData] = results;
          setAssociations(assocData.associations || []);
          setElections(electionData.elections || []);
        } else {
          const [electionData] = results;
          setElections(electionData.elections || []);
        }
      } catch (err) {
        if (err.status === 401) {
          window.location.href = '/login';
          return;
        }
        setError('Erreur lors du chargement des données');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return <Spinner />;
  }

  const openCount = elections.filter((e) => e.state === 'OPEN').length;
  const recentAssociations = associations.slice(0, 5);
  const recentElections = elections.slice(0, 5);

  return (
    <>
      {error && <Alert>{error}</Alert>}

      {/* Stat cards */}
      <div className={styles.statGrid}>
        {isFullAdmin && (
          <div className={`${styles.statCard} ${styles.statCardGreen}`}>
            <div className={`${styles.statIconWrap} ${styles.statIconGreen}`}>🏛️</div>
            <div className={`${styles.statNumber} ${styles.statNumberGreen}`}>{associations.length}</div>
            <div className={styles.statLabel}>Associations</div>
          </div>
        )}
        <div className={`${styles.statCard} ${styles.statCardOrange}`}>
          <div className={`${styles.statIconWrap} ${styles.statIconOrange}`}>🗳️</div>
          <div className={`${styles.statNumber} ${styles.statNumberOrange}`}>{elections.length}</div>
          <div className={styles.statLabel}>Élections fédérales</div>
        </div>
        <div className={`${styles.statCard} ${styles.statCardBlue}`}>
          <div className={`${styles.statIconWrap} ${styles.statIconBlue}`}>✅</div>
          <div className={styles.statNumber}>{openCount}</div>
          <div className={styles.statLabel}>Élections ouvertes</div>
        </div>
      </div>

      {/* Recent panels */}
      <div className={styles.panelGrid}>
        {isFullAdmin && (
          <Card>
            <CardHeader
              title="Associations récentes"
              action={<Link className={styles.panelLink} href="/federation/associations">Voir tout</Link>}
            />
            {recentAssociations.length === 0 ? (
              <p className={styles.muted}>Aucune association enregistrée.</p>
            ) : (
              <ul className={styles.itemList}>
                {recentAssociations.map((assoc) => (
                  <li key={assoc.id} className={styles.itemRow}>
                    {assoc.logo_ref ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={styles.logoThumb} src={assoc.logo_ref} alt={assoc.name} />
                    ) : (
                      <div className={styles.logoThumbPlaceholder} aria-hidden="true">
                        {assoc.name?.charAt(0) || '?'}
                      </div>
                    )}
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>{assoc.name}</span>
                      <span className={styles.muted}>{assoc.president_name}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card className={!isFullAdmin ? styles.panelFull : ''}>
          <CardHeader
            title="Élections récentes"
            action={<Link className={styles.panelLink} href="/federation/elections">Voir tout</Link>}
          />
          {recentElections.length === 0 ? (
            <p className={styles.muted}>Aucune élection fédérale créée.</p>
          ) : (
            <ul className={styles.itemList}>
              {recentElections.map((election) => (
                <li key={election.id} className={styles.itemRow}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{election.name}</span>
                  </div>
                  <StateBadge state={election.state} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
