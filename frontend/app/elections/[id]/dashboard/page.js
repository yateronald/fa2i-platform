'use client';

import { use, useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react';
import { apiClient } from '@/lib/apiClient';
import { resolveMediaUrl } from '@/lib/media';
import VotePieChart from '@/components/results/VotePieChart';
import { StateBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { DashboardContext } from '@/components/layout/DashboardShell';
import styles from './dashboard.module.css';

/**
 * Real-time election results dashboard — modern redesign.
 *
 * - Polls GET /elections/:id/results every 5 seconds (Req 17.3) and keeps the
 *   last-good data on transient errors.
 * - Polls GET /elections/:id/positions alongside it to merge per-position
 *   `state` (OPEN / PENDING / CLOSED) and exclude DRAFT / unpublished posts.
 * - 403 → access-denied message, polling stops (Req 16.3, 17.4).
 * - Summary stat tiles + a position selector (pills) + a per-position detail
 *   panel (donut chart + candidate breakdown) so results are not dumped onto
 *   one long stacked list.
 *
 * Requirements: 16.2, 16.3, 17.1, 17.2, 17.3, 17.5, 17.6, 18.1
 */
export default function ElectionDashboardPage({ params }) {
  const { id } = use(params);

  const [dashboard, setDashboard] = useState(null);
  const [positionStates, setPositionStates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failedPositions, setFailedPositions] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedPositionId, setSelectedPositionId] = useState(null);

  const intervalRef = useRef(null);
  const dashboardRef = useRef(null);

  const fetchDashboard = useCallback(async (isInitial = false) => {
    try {
      // Fetch results and position metadata together so state badges and the
      // draft exclusion always reflect the latest server view.
      const [data, positionsRes] = await Promise.all([
        apiClient.get(`/elections/${id}/results`),
        apiClient.get(`/elections/${id}/positions`).catch(() => null),
      ]);

      if (positionsRes && Array.isArray(positionsRes.positions)) {
        setPositionStates(positionsRes.positions);
      }

      if (data.success && data.dashboard) {
        const newDashboard = data.dashboard;

        // Retain last-good data for any positions the backend flagged as failed
        // (Req 17.6).
        if (newDashboard.failedPositions && newDashboard.failedPositions.length > 0) {
          setFailedPositions(newDashboard.failedPositions);
          if (dashboardRef.current) {
            const lastPositions = dashboardRef.current.positions || [];
            newDashboard.positions = newDashboard.positions.map((pos) => {
              if (newDashboard.failedPositions.includes(pos.position_id)) {
                const lastGood = lastPositions.find((p) => p.position_id === pos.position_id);
                return lastGood || pos;
              }
              return pos;
            });
          }
        } else {
          setFailedPositions([]);
        }

        setDashboard(newDashboard);
        dashboardRef.current = newDashboard;
        setLastUpdated(new Date());
        setError('');
      }
    } catch (err) {
      if (err.status === 403) {
        // Access denied — no counts on denial (Req 17.4)
        setError('Vous n’êtes pas autorisé à consulter ces résultats.');
        setDashboard(null);
        dashboardRef.current = null;
        stopRefresh();
      } else if (isInitial) {
        setError(err.message || 'Impossible de charger le tableau de bord');
      }
      // On non-initial refresh errors, keep last-good data displayed.
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  }, [id]);

  const { setExtraHeader } = useContext(DashboardContext);

  useEffect(() => {
    setExtraHeader(
      <div className={styles.topbarLiveWrap}>
        <span className={styles.liveTagTopbar}>
          <span className={styles.refreshDotTopbar} aria-hidden="true" />
          En direct
        </span>
        <span className={styles.refreshIndicatorTopbar}>
          {lastUpdated
            ? `Mis à jour à ${lastUpdated.toLocaleTimeString('fr-FR')}`
            : 'Synchronisation...'}
        </span>
      </div>
    );
    return () => setExtraHeader(null);
  }, [lastUpdated, setExtraHeader]);

  function stopRefresh() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    fetchDashboard(true);

    // Auto-refresh every 5 seconds (Req 17.3).
    intervalRef.current = setInterval(() => {
      fetchDashboard(false);
    }, 5000);

    return () => {
      stopRefresh();
    };
  }, [fetchDashboard]);

  // Merge per-position state into the results positions and drop drafts.
  const positions = useMemo(() => {
    const raw = dashboard?.positions || [];
    const stateById = new Map(positionStates.map((p) => [p.id, p]));
    return raw
      .map((pos) => {
        const meta = stateById.get(pos.position_id);
        return {
          ...pos,
          state: meta?.state || null,
          published: meta ? meta.published : undefined,
        };
      })
      .filter((pos) => {
        // Exclude drafts. If we have no metadata yet, keep the position so the
        // dashboard is not empty during the very first paint.
        if (pos.state === 'DRAFT') return false;
        if (pos.published === false) return false;
        return true;
      });
  }, [dashboard, positionStates]);

  // Keep the user's selection across refreshes; default to the first position.
  useEffect(() => {
    if (positions.length === 0) {
      if (selectedPositionId !== null) setSelectedPositionId(null);
      return;
    }
    const stillExists = positions.some((p) => p.position_id === selectedPositionId);
    if (!stillExists) {
      setSelectedPositionId(positions[0].position_id);
    }
  }, [positions, selectedPositionId]);

  // Loading state
  if (loading) {
    return <Spinner label="Chargement du tableau de bord..." />;
  }

  // Authorization error state (or initial load error)
  if (error && !dashboard) {
    return <Alert type="error">{error}</Alert>;
  }

  const { totalVoters = 0, totalBallots = 0 } = dashboard || {};
  const participation = totalVoters > 0
    ? Math.round((totalBallots / totalVoters) * 100)
    : 0;
  const hasPositions = positions.length > 0;

  const selectedPosition =
    positions.find((p) => p.position_id === selectedPositionId) || positions[0] || null;

  return (
    <div className={styles.dashboard}>
      {/* ── Summary stat tiles ─────────────────────────────── */}
      <div className={styles.statGrid}>
        <div className={`${styles.statCard} ${styles.statCardGreen}`}>
          <div className={styles.statTop}>
            <div className={`${styles.statIconWrap} ${styles.statIconGreen}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
          </div>
          <div className={styles.statNumber}>{totalVoters}</div>
          <div className={styles.statLabel}>Électeurs inscrits</div>
        </div>

        <div className={`${styles.statCard} ${styles.statCardOrange}`}>
          <div className={styles.statTop}>
            <div className={`${styles.statIconWrap} ${styles.statIconOrange}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </div>
          </div>
          <div className={styles.statNumber}>{totalBallots}</div>
          <div className={styles.statLabel}>Bulletins soumis</div>
        </div>

        <div className={`${styles.statCard} ${styles.statCardBlue}`}>
          <div className={styles.statTop}>
            <div className={`${styles.statIconWrap} ${styles.statIconBlue}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
          </div>
          <div className={styles.statNumber}>{participation}%</div>
          <div className={styles.statLabel}>Taux de participation</div>
        </div>
      </div>

      {/* ── Positions ──────────────────────────────────────── */}
      {!hasPositions ? (
        <EmptyState
          icon="📊"
          title="Aucun poste publié"
          text="Aucun résultat à afficher pour le moment. Les postes apparaîtront ici une fois publiés."
        />
      ) : (
        <>
          {/* Position selector pills */}
          <div className={styles.selectorSection}>
            <div className={styles.selectorHeader}>
              <h2 className={styles.sectionTitle}>Résultats par poste</h2>
              <span className={styles.sectionCount}>{positions.length}</span>
            </div>
            <div className={styles.pillRow} role="tablist" aria-label="Postes">
              {positions.map((pos) => {
                const isActive = selectedPosition?.position_id === pos.position_id;
                return (
                  <button
                    key={pos.position_id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`${styles.pill} ${isActive ? styles.pillActive : ''}`}
                    onClick={() => setSelectedPositionId(pos.position_id)}
                  >
                    <span className={styles.pillName}>{pos.name}</span>
                    {pos.state && (
                      <span className={styles.pillBadge}>
                        <StateBadge state={pos.state} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected-position detail panel */}
          {selectedPosition && (
            <PositionDetail
              position={selectedPosition}
              failed={failedPositions.includes(selectedPosition.position_id)}
            />
          )}
        </>
      )}
    </div>
  );
}

const PALETTE = [
  'var(--fa2i-green)',
  'var(--fa2i-orange)',
  '#2563eb',
  '#9333ea',
  '#0891b2',
  '#dc2626',
  '#ca8a04',
  '#15803d',
  '#db2777',
  '#475569',
];

/**
 * Detail panel for the selected position: donut chart + candidate breakdown.
 */
function PositionDetail({ position, failed }) {
  const candidates = position.candidates || [];
  const sorted = [...candidates].sort((a, b) => (b.count || 0) - (a.count || 0));
  const totalVotes = sorted.reduce((sum, c) => sum + (c.count || 0), 0);
  const votesCast = typeof position.votesCast === 'number' ? position.votesCast : totalVotes;
  const leaderId =
    totalVotes > 0 ? sorted[0]?.candidate_id || sorted[0]?.id : null;

  const chartData = sorted.map((c) => ({
    label: c.name,
    value: c.count || 0,
    photo_ref: c.photo_ref,
  }));

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderLeft}>
          <h3 className={styles.detailTitle}>{position.name}</h3>
          {position.state && <StateBadge state={position.state} />}
        </div>
        <span className={styles.detailVotes}>
          {votesCast} vote{votesCast !== 1 ? 's' : ''} exprimé{votesCast !== 1 ? 's' : ''}
        </span>
      </div>

      {failed && (
        <div className={styles.warning} role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Données partiellement indisponibles. Derniers résultats affichés.
        </div>
      )}

      {candidates.length === 0 ? (
        <p className={styles.detailEmpty}>Aucun candidat pour ce poste.</p>
      ) : (
        <div className={styles.detailGrid}>
          {/* Donut chart */}
          <div className={styles.chartCol}>
            <VotePieChart data={chartData} size={220} showLegend={false} />
            {totalVotes === 0 && (
              <p className={styles.zeroNotice}>Aucun vote enregistré pour le moment.</p>
            )}
          </div>

          {/* Candidate breakdown */}
          <div className={styles.breakdownCol} role="list" aria-label={`Détail des voix pour ${position.name}`}>
            {sorted.map((candidate, index) => {
              const cId = candidate.candidate_id || candidate.id;
              const pct = totalVotes > 0
                ? Math.round(((candidate.count || 0) / totalVotes) * 100)
                : 0;
              const isLeader = totalVotes > 0 && cId === leaderId;
              const color = PALETTE[index % PALETTE.length];
              return (
                <CandidateRow
                  key={cId}
                  candidate={candidate}
                  pct={pct}
                  isLeader={isLeader}
                  color={color}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateRow({ candidate, pct, isLeader, color }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = (candidate.name || '?').trim().charAt(0).toUpperCase();
  const photoUrl = resolveMediaUrl(candidate.photo_ref);
  const count = candidate.count || 0;

  return (
    <div
      className={`${styles.candidateRow} ${isLeader ? styles.candidateLeader : ''}`}
      role="listitem"
    >
      {photoUrl && !imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={candidate.name}
          className={styles.candidatePhoto}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className={styles.candidatePhotoFallback} style={{ background: color }}>
          {initial}
        </span>
      )}

      <div className={styles.candidateBody}>
        <div className={styles.candidateTopRow}>
          <span className={styles.candidateName}>
            {candidate.name}
            {isLeader && <span className={styles.leaderBadge}>En tête</span>}
          </span>
          <span className={styles.candidatePct} style={{ color }}>{pct}%</span>
        </div>
        <div className={styles.barContainer}>
          <div
            className={styles.bar}
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <span className={styles.candidateCount}>
          {count} vote{count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
