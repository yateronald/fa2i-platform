'use client';

import { useState } from 'react';
import { resolveMediaUrl } from '@/lib/media';
import styles from './PositionTally.module.css';

/**
 * PositionTally — Premium card showing vote counts per candidate for one position.
 *
 * Features:
 * - Candidate photos with fallback initials
 * - Animated progress bars with gradient fills
 * - Winner crown indicator for the leading candidate
 * - Percentage and vote count display
 * - Failed state with warning banner
 *
 * Props:
 * - position: { id, name }
 * - candidates: Array<{ id, candidate_id, name, photo_ref, count }>
 * - failed: boolean (if retrieval failed for this position)
 */
export default function PositionTally({ position, candidates, failed, totalVoters = 0 }) {
  const sorted = [...(candidates || [])].sort((a, b) => (b.count || 0) - (a.count || 0));
  const maxCount = Math.max(1, ...(sorted.map((c) => c.count || 0)));
  const totalVotes = sorted.reduce((sum, c) => sum + (c.count || 0), 0);
  const leaderId = totalVotes > 0 ? sorted[0]?.candidate_id || sorted[0]?.id : null;
  const positionLabel = position?.order ? `Poste ${position.order}` : 'Poste';
  const shortId = position?.id ? String(position.id).slice(0, 8) : null;

  const remainingVotes = Math.max(0, totalVoters - totalVotes);
  const participation = totalVoters > 0 ? Math.round((totalVotes / totalVoters) * 100) : 0;

  return (
    <div className={styles.card}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleBlock}>
            <div className={styles.titleRow}>
              <span className={styles.positionKickerInline}>
                {positionLabel}
              </span>
              <h3 className={styles.positionNameInline}>{position?.name || 'Position'}</h3>
              <div className={styles.participationBadge}>
                <span className={styles.participationBadgeText}>
                  {totalVotes} vote{totalVotes !== 1 ? 's' : ''} • {remainingVotes} restant{remainingVotes !== 1 ? 's' : ''}
                </span>
                <div className={styles.badgeChartWrap} title={`Participation: ${participation}%`}>
                  <svg width="16" height="16" viewBox="0 0 18 18" className={styles.miniCirc}>
                    <circle
                      cx="9"
                      cy="9"
                      r="7"
                      fill="none"
                      stroke="var(--border-subtle)"
                      strokeWidth="2"
                    />
                    <circle
                      cx="9"
                      cy="9"
                      r="7"
                      fill="none"
                      stroke="var(--fa2i-green)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray={43.98}
                      strokeDashoffset={43.98 * (1 - participation / 100)}
                      style={{
                        transition: 'stroke-dashoffset 0.5s ease',
                      }}
                    />
                  </svg>
                </div>
                <span className={styles.badgePct}>
                  {participation}%
                </span>
              </div>
          </div>
        </div>
      </div>
    </div>

      {failed && (
        <div className={styles.warning} role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Données partiellement indisponibles. Derniers résultats affichés.
        </div>
      )}

      {(!candidates || candidates.length === 0) && !failed && (
        <p className={styles.empty}>Aucun candidat pour {position?.name || 'ce poste'}.</p>
      )}

      {sorted.length > 0 && totalVotes === 0 && !failed && (
        <p className={styles.zeroNotice}>Aucun vote enregistré pour ce poste.</p>
      )}

      {sorted.length > 0 && (
        <div className={styles.candidateList} role="list" aria-label={`Résultats pour ${position?.name}`}>
          {sorted.map((candidate, index) => {
            const percentage = totalVotes > 0
              ? Math.round((candidate.count / totalVotes) * 100)
              : 0;
            const barWidth = maxCount > 0
              ? Math.round((candidate.count / maxCount) * 100)
              : 0;
            const isLeader = totalVotes > 0 && (candidate.candidate_id || candidate.id) === leaderId;

            return (
              <CandidateRow
                key={candidate.candidate_id || candidate.id}
                candidate={candidate}
                percentage={percentage}
                barWidth={barWidth}
                isLeader={isLeader}
                colorIndex={index}
              />
            );
          })}
        </div>
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

function CandidateRow({ candidate, percentage, barWidth, isLeader, colorIndex }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = (candidate.name || '?').trim().charAt(0).toUpperCase();
  const color = PALETTE[colorIndex % PALETTE.length];
  const photoUrl = resolveMediaUrl(candidate.photo_ref);

  return (
    <div className={`${styles.candidateRow} ${isLeader ? styles.candidateLeader : ''}`} role="listitem">
      <div className={styles.candidateLeft}>
        {/* Photo */}
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

        {/* Name + percentage */}
        <div className={styles.candidateInfo}>
          <div className={styles.candidateNameRow}>
            {isLeader && (
              <span className={styles.leaderBadge} title="En tête">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M12 1L15.09 7.26L22 8.27L17 13.14L18.18 20.02L12 16.77L5.82 20.02L7 13.14L2 8.27L8.91 7.26L12 1Z" />
                </svg>
              </span>
            )}
            <span className={styles.candidateName}>{candidate.name}</span>
          </div>
          <span className={styles.candidateCount}>
            {candidate.count} vote{candidate.count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Right side: percentage + bar */}
      <div className={styles.candidateRight}>
        <span className={styles.candidatePct} style={{ color }}>{percentage}%</span>
        <div className={styles.barContainer}>
          <div
            className={styles.bar}
            style={{
              width: `${barWidth}%`,
              background: color,
            }}
          />
        </div>
      </div>
    </div>
  );
}
