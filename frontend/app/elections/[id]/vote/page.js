'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/apiClient';
import { formatDisplayTime } from '@/lib/timezone';
import { resolveMediaUrl } from '@/lib/media';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StateBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Alert } from '@/components/ui/Alert';
import styles from './vote.module.css';

/**
 * Voter ballot page — PER-POST voting model.
 *
 * Each post (position) has its own voting window and state ('OPEN' | 'CLOSED').
 * A voter casts one vote per open post, one post at a time. Each post card
 * manages its own selection, loading, error and "voted" state independently.
 *
 * Backend:
 *  - GET  /elections/:id
 *  - GET  /elections/:id/positions
 *  - GET  /elections/:id/positions/:positionId/candidates
 *  - POST /elections/:id/positions/:positionId/vote  { candidateId }
 */
export default function VotePage({ params }) {
  const { id } = use(params);

  const [election, setElection] = useState(null);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const electionData = await apiClient.get(`/elections/${id}`);
      setElection(electionData.election || electionData);

      // Single request returns positions WITH their candidates (avoids N+1 —
      // faster on mobile networks).
      const positionsData = await apiClient.get(
        `/elections/${id}/positions?include=candidates`
      );
      const positionsList = positionsData.positions || positionsData || [];

      // Only published posts (state PENDING/OPEN/CLOSED) appear on the voter
      // ballot. Drafts (published === false / state === 'DRAFT') are excluded.
      const positionsWithCandidates = positionsList
        .filter((position) => position.published === true)
        .map((position) => ({
          ...position,
          candidates: position.candidates || [],
        }));

      setPositions(positionsWithCandidates);
    } catch (err) {
      setError(
        err.message || 'Impossible de charger les informations de l’élection.'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <Spinner label="Chargement des postes..." />;
  }

  if (error) {
    return (
      <>
        <Alert type="error">{error}</Alert>
        <Link href="/elections" className={styles.backLink}>
          &larr; Retour à mes élections
        </Link>
      </>
    );
  }

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h1 className={styles.electionName}>{election?.name || 'Élection'}</h1>
          {election?.state && <StateBadge state={election.state} />}
        </div>
        <p className={styles.headerNote}>
          Chaque poste a sa propre période de vote. Votez pour chaque poste
          lorsqu’il est ouvert.
        </p>
      </div>

      {positions.length === 0 ? (
        <EmptyState
          icon="🗳️"
          title="Aucun poste"
          text="Cette élection ne comporte aucun poste pour le moment."
        />
      ) : (
        <div className={styles.positionsList}>
          {positions.map((position) => (
            <PositionVoteCard
              key={position.id}
              electionId={id}
              position={position}
            />
          ))}
        </div>
      )}

      <Link href="/elections" className={styles.backLink}>
        &larr; Retour à mes élections
      </Link>
    </>
  );
}

/**
 * A single post card. Manages its own selection, submission and voted state.
 */
function PositionVoteCard({ electionId, position }) {
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [voted, setVoted] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState(null);
  const [votedMessage, setVotedMessage] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const isOpen = position.state === 'OPEN';
  const candidates = position.candidates || [];
  const windowText = renderWindow(position);

  async function handleVote() {
    if (!selected) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await apiClient.post(
        `/elections/${electionId}/positions/${position.id}/vote`,
        { candidateId: selected }
      );
      setVoted(true);
      setConfirmedAt(result?.confirmedAt || null);
      setVotedMessage(null);
    } catch (err) {
      const status = err.status;
      const message = (err.message || '').toLowerCase();

      if (status === 409 || message.includes('déjà voté')) {
        setVoted(true);
        setVotedMessage('Vous avez déjà voté pour ce poste.');
      } else if (status === 403) {
        setErrorMsg(
          'Vous n’êtes pas éligible pour voter dans cette élection.'
        );
      } else if (status === 400) {
        setErrorMsg('Le vote n’est pas ouvert pour ce poste.');
      } else {
        setErrorMsg(
          err.message || 'Une erreur est survenue lors de l’envoi de votre vote.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className={styles.positionCard}>
      <div className={styles.positionHead}>
        <h2 className={styles.positionName}>{position.name}</h2>
        <StateBadge state={position.state} />
      </div>

      {windowText && (
        <p className={styles.window}>
          <span className={styles.windowLabel}>Vote :</span> {windowText}
        </p>
      )}

      {/* Already voted (this session) — success or already-voted notice */}
      {voted ? (
        votedMessage ? (
          <div className={`${styles.statusMsg} ${styles.statusInfo}`}>
            {votedMessage}
          </div>
        ) : (
          <div className={`${styles.statusMsg} ${styles.statusSuccess}`}>
            <span className={styles.checkmark}>✓</span>
            <div>
              <div className={styles.successTitle}>
                Votre vote a été enregistré
              </div>
              {confirmedAt && (
                <div className={styles.confirmedAt}>
                  {(() => {
                    const c = formatDisplayTime(confirmedAt);
                    return `${c.text} (${c.zoneLabel})`;
                  })()}
                </div>
              )}
            </div>
          </div>
        )
      ) : isOpen ? (
        <>
          {candidates.length === 0 ? (
            <p className={styles.muted}>Aucun candidat pour ce poste.</p>
          ) : (
            <div
              className={styles.candidates}
              role="radiogroup"
              aria-label={position.name}
            >
              {candidates.map((candidate) => {
                const isSel = selected === candidate.id;
                return (
                  <label
                    key={candidate.id}
                    className={`${styles.candidate} ${
                      isSel ? styles.candidateSelected : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name={`position-${position.id}`}
                      value={candidate.id}
                      checked={isSel}
                      onChange={() => setSelected(candidate.id)}
                      className={styles.radio}
                    />
                    <CandidatePhoto candidate={candidate} />
                    <div className={styles.candidateInfo}>
                      <span className={styles.candidateName}>
                        {candidate.name}
                      </span>
                      {candidate.motivation && (
                        <p className={styles.candidateMotivation}>
                          &laquo; {candidate.motivation} &raquo;
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {errorMsg && (
            <div className={styles.errorWrap}>
              <Alert type="error">{errorMsg}</Alert>
            </div>
          )}

          {candidates.length > 0 && (
            <div className={styles.voteRow}>
              <Button
                variant="primary"
                onClick={handleVote}
                disabled={!selected || submitting}
              >
                {submitting ? 'Envoi en cours...' : 'Voter pour ce poste'}
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className={`${styles.statusMsg} ${styles.statusMuted}`}>
          {closedMessage(position)}
        </div>
      )}
    </Card>
  );
}

/**
 * Circular photo thumbnail with an initial fallback.
 */
function CandidatePhoto({ candidate }) {
  const [failed, setFailed] = useState(false);
  const initial = (candidate.name || '?').trim().charAt(0).toUpperCase();
  const photoUrl = resolveMediaUrl(candidate.photo_ref);

  if (photoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={`Photo de ${candidate.name}`}
        className={styles.photo}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className={styles.photoFallback} aria-hidden="true">
      {initial}
    </span>
  );
}

/**
 * Build the "{start} → {end} ({tz})" voting window string.
 */
function renderWindow(position) {
  const { start_at, end_at, schedule_timezone } = position;
  if (!start_at || !end_at) return null;
  const start = formatDisplayTime(start_at, schedule_timezone);
  const end = formatDisplayTime(end_at, schedule_timezone);
  return `${start.text} → ${end.text} (${start.zoneLabel})`;
}

/**
 * Choose the closed-state message based on whether the window has started.
 */
function closedMessage(position) {
  const { start_at, schedule_timezone } = position;
  if (start_at) {
    const now = new Date();
    const start = new Date(start_at);
    if (now < start) {
      const s = formatDisplayTime(start_at, schedule_timezone);
      return `Le vote ouvrira le ${s.text} (${s.zoneLabel}).`;
    }
  }
  return 'Le vote pour ce poste est clôturé.';
}
