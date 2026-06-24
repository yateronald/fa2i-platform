'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/ui/Button';
import { StateBadge, Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Alert } from '@/components/ui/Alert';
import { Modal } from '@/components/ui/Modal';
import VotePieChart from '@/components/results/VotePieChart';
import { resolveMediaUrl } from '@/lib/media';
import { formatDisplayTime } from '@/lib/timezone';
import styles from './elections.module.css';

const FA2I_LOGO = '/fa2i-logo.jpg';

/**
 * Voter home — redesigned experience.
 *
 * A small state machine drives the view:
 *   'home'        → choose between federation / association elections
 *   'federation'  → aggregated published posts for FEDERATION elections
 *   'association' → aggregated published posts for the voter's ASSOCIATION
 *
 * Voting and results are handled inside modals so the voter never leaves the
 * page. Manager pages ([id]/dashboard, [id]/vote) are untouched.
 */
export default function ElectionsPage() {
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('home'); // 'home' | 'federation' | 'association'

  // Aggregated posts for the active scope view.
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState('');

  // Active modal: { type: 'vote' | 'results', post } | null
  const [modal, setModal] = useState(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const data = await apiClient.get('/elections');
        setElections(data.elections || []);
      } catch (err) {
        if (err.status === 401) {
          window.location.href = '/login';
          return;
        }
        setError('Erreur lors du chargement des élections.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const federationElections = elections.filter((e) => e.scope === 'FEDERATION');
  const associationElections = elections.filter((e) => e.scope === 'ASSOCIATION');

  // Voters belong to a single association — derive its identity from the
  // first association election available.
  const association = associationElections[0]
    ? {
        name: associationElections[0].association_name,
        logo: associationElections[0].association_logo,
      }
    : null;

  // Aggregate published posts across all elections of the active scope.
  const loadPosts = useCallback(async (scopeElections) => {
    setPostsLoading(true);
    setPostsError('');
    setPosts([]);
    try {
      const grouped = await Promise.all(
        scopeElections.map(async (election) => {
          try {
            const data = await apiClient.get(
              `/elections/${election.id}/positions`
            );
            const list = data.positions || data || [];
            return list
              .filter((p) => p.published === true)
              .map((p) => ({
                ...p,
                electionId: election.id,
                electionName: election.name,
                electionTimezone: election.schedule_timezone,
              }));
          } catch {
            return [];
          }
        })
      );
      setPosts(grouped.flat());
    } catch {
      setPostsError('Erreur lors du chargement des postes.');
    } finally {
      setPostsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'federation') {
      loadPosts(federationElections);
    } else if (view === 'association') {
      loadPosts(associationElections);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function markPostVoted(post) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id && p.electionId === post.electionId
          ? { ...p, has_voted: true }
          : p
      )
    );
  }

  if (loading) {
    return <Spinner label="Chargement de vos élections..." />;
  }

  if (error) {
    return <Alert type="error">{error}</Alert>;
  }

  const hasAny = federationElections.length > 0 || associationElections.length > 0;

  return (
    <>
      {view === 'home' && (
        <HomeView
          hasFederation={federationElections.length > 0}
          hasAssociation={associationElections.length > 0}
          association={association}
          hasAny={hasAny}
          onSelect={setView}
        />
      )}

      {(view === 'federation' || view === 'association') && (
        <ScopeView
          scope={view}
          association={view === 'association' ? association : null}
          posts={posts}
          loading={postsLoading}
          error={postsError}
          onBack={() => setView('home')}
          onVote={(post) => setModal({ type: 'vote', post })}
          onResults={(post) => setModal({ type: 'results', post })}
        />
      )}

      {modal?.type === 'vote' && (
        <VoteModal
          post={modal.post}
          onClose={() => setModal(null)}
          onVoted={() => markPostVoted(modal.post)}
        />
      )}

      {modal?.type === 'results' && (
        <ResultsModal post={modal.post} onClose={() => setModal(null)} />
      )}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * HOME VIEW
 * ──────────────────────────────────────────────────────────────────────── */

function HomeView({ hasFederation, hasAssociation, association, hasAny, onSelect }) {
  return (
    <div className={styles.home}>
      <header className={styles.hero}>
        <span className={styles.heroEyebrow}>Espace électeur</span>
        <h1 className={styles.heroTitle}>Bienvenue sur votre espace de vote</h1>
        <p className={styles.heroSubtitle}>
          Choisissez un type d&apos;élection pour consulter les postes, voter
          et découvrir les résultats.
        </p>
      </header>

      {!hasAny ? (
        <EmptyState
          icon="🗳️"
          title="Aucune élection"
          text="Aucune élection n'est disponible pour le moment."
        />
      ) : (
        <div className={styles.choiceGrid}>
          {hasFederation && (
            <ChoiceCard
              logo={FA2I_LOGO}
              logoAlt="FA2I"
              title="Élections fédérales"
              subtitle="Fédération des Associations Ivoiriennes en Inde"
              onClick={() => onSelect('federation')}
            />
          )}
          {hasAssociation && (
            <ChoiceCard
              logo={association?.logo}
              logoAlt={association?.name || 'Association'}
              title="Élections de mon association"
              subtitle={association?.name || 'Mon association'}
              onClick={() => onSelect('association')}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ChoiceCard({ logo, logoAlt, title, subtitle, onClick }) {
  return (
    <button type="button" className={styles.choiceCard} onClick={onClick}>
      <div className={styles.choiceLogoWrap}>
        <LogoImage src={logo} alt={logoAlt} className={styles.choiceLogo} />
      </div>
      <div className={styles.choiceBody}>
        <h2 className={styles.choiceTitle}>{title}</h2>
        <p className={styles.choiceSubtitle}>{subtitle}</p>
      </div>
      <span className={styles.choiceArrow} aria-hidden="true">→</span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * SCOPE VIEW
 * ──────────────────────────────────────────────────────────────────────── */

function ScopeView({
  scope,
  association,
  posts,
  loading,
  error,
  onBack,
  onVote,
  onResults,
}) {
  const open = posts.filter((p) => p.state === 'OPEN');
  const pending = posts.filter((p) => p.state === 'PENDING');
  const closed = posts.filter((p) => p.state === 'CLOSED');

  return (
    <div className={styles.scope}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        ← Retour
      </button>

      {scope === 'association' && association ? (
        <div className={styles.scopeHeaderBand}>
          <div className={styles.scopeLogoWrap}>
            <LogoImage
              src={association.logo}
              alt={association.name || 'Association'}
              className={styles.scopeLogo}
            />
          </div>
          <div>
            <span className={styles.scopeEyebrow}>Élections de mon association</span>
            <h1 className={styles.scopeTitle}>{association.name || 'Mon association'}</h1>
          </div>
        </div>
      ) : (
        <div className={styles.scopeHeaderBand}>
          <div className={styles.scopeLogoWrap}>
            <LogoImage src={FA2I_LOGO} alt="FA2I" className={styles.scopeLogo} />
          </div>
          <div>
            <span className={styles.scopeEyebrow}>Élections fédérales</span>
            <h1 className={styles.scopeTitle}>
              Fédération des Associations Ivoiriennes en Inde
            </h1>
          </div>
        </div>
      )}

      {error && <Alert type="error">{error}</Alert>}

      {loading ? (
        <Spinner label="Chargement des postes..." />
      ) : posts.length === 0 ? (
        <EmptyState
          icon="🗳️"
          title="Aucun poste"
          text="Aucun poste n'est disponible pour le moment."
        />
      ) : (
        <>
          <PostSection title="Postes ouverts" posts={open}>
            {(post) => (
              <PostCard
                key={`${post.electionId}-${post.id}`}
                post={post}
                action={
                  post.has_voted ? (
                    <Badge variant="open">Voté ✓</Badge>
                  ) : (
                    <Button variant="primary" onClick={() => onVote(post)}>
                      Voter
                    </Button>
                  )
                }
              />
            )}
          </PostSection>

          <PostSection title="À venir" posts={pending}>
            {(post) => (
              <PostCard
                key={`${post.electionId}-${post.id}`}
                post={post}
                action={
                  <span className={styles.mutedAction}>
                    Ouvre le {formatStart(post)}
                  </span>
                }
              />
            )}
          </PostSection>

          <PostSection title="Clôturés" posts={closed}>
            {(post) => (
              <PostCard
                key={`${post.electionId}-${post.id}`}
                post={post}
                action={
                  <Button variant="outline" onClick={() => onResults(post)}>
                    Voir les résultats
                  </Button>
                }
              />
            )}
          </PostSection>
        </>
      )}
    </div>
  );
}

function PostSection({ title, posts, children }) {
  if (!posts || posts.length === 0) return null;
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        {title}
        <span className={styles.sectionCount}>{posts.length}</span>
      </h2>
      <div className={styles.postGrid}>{posts.map((post) => children(post))}</div>
    </section>
  );
}

function PostCard({ post, action }) {
  return (
    <div className={styles.postCard}>
      <div className={styles.postCardHead}>
        <h3 className={styles.postName}>{post.name}</h3>
        <StateBadge state={post.state} />
      </div>
      <p className={styles.postElection}>{post.electionName}</p>
      <p className={styles.postWindow}>{renderWindow(post)}</p>
      <div className={styles.postAction}>{action}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * VOTE MODAL
 * ──────────────────────────────────────────────────────────────────────── */

function VoteModal({ post, onClose, onVoted }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);
  const [step, setStep] = useState('select'); // 'select' | 'confirm' | 'done'
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmedAt, setConfirmedAt] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await apiClient.get(
          `/elections/${post.electionId}/positions/${post.id}/candidates`
        );
        if (active) setCandidates(data.candidates || data || []);
      } catch {
        if (active) setLoadError('Impossible de charger les candidats.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [post.electionId, post.id]);

  const selectedCandidate = candidates.find((c) => c.id === selected) || null;

  async function handleConfirm() {
    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await apiClient.post(
        `/elections/${post.electionId}/positions/${post.id}/vote`,
        { candidateId: selected }
      );
      setConfirmedAt(result?.confirmedAt || null);
      setStep('done');
      onVoted();
    } catch (err) {
      const status = err.status;
      if (status === 409) {
        setSubmitError('Vous avez déjà voté pour ce poste.');
        onVoted();
      } else if (status === 403) {
        setSubmitError("Vous n'êtes pas éligible pour voter pour ce poste.");
      } else if (status === 400) {
        setSubmitError("Le vote n'est pas ouvert pour ce poste.");
      } else {
        setSubmitError(
          err.message || "Une erreur est survenue lors de l'envoi de votre vote."
        );
      }
      setStep('select');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open title={post.name} onClose={onClose}>
      {loading ? (
        <Spinner label="Chargement des candidats..." />
      ) : loadError ? (
        <Alert type="error">{loadError}</Alert>
      ) : step === 'done' ? (
        <div className={styles.successBox}>
          <span className={styles.successCheck}>✓</span>
          <h3 className={styles.successTitle}>Votre vote a été enregistré</h3>
          {confirmedAt && (
            <p className={styles.successMeta}>
              {(() => {
                const c = formatDisplayTime(confirmedAt);
                return `${c.text} (${c.zoneLabel})`;
              })()}
            </p>
          )}
          <Button variant="secondary" block onClick={onClose}>
            Fermer
          </Button>
        </div>
      ) : step === 'confirm' ? (
        <div className={styles.confirmBox}>
          <div className={styles.warningBanner}>
            ⚠️ Votre vote est définitif et ne peut pas être modifié ni annulé.
          </div>
          <p className={styles.confirmText}>
            Vous êtes sur le point de voter pour&nbsp;:
          </p>
          <p className={styles.confirmName}>{selectedCandidate?.name}</p>
          {submitError && <Alert type="error">{submitError}</Alert>}
          <div className={styles.modalFooter}>
            <Button
              variant="outline"
              onClick={() => setStep('select')}
              disabled={submitting}
            >
              Retour
            </Button>
            <Button variant="primary" onClick={handleConfirm} disabled={submitting}>
              {submitting ? 'Envoi en cours...' : 'Confirmer mon vote'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {candidates.length === 0 ? (
            <p className={styles.mutedNote}>Aucun candidat pour ce poste.</p>
          ) : (
            <div className={styles.candidates} role="radiogroup" aria-label={post.name}>
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
                      name={`candidate-${post.id}`}
                      value={candidate.id}
                      checked={isSel}
                      onChange={() => setSelected(candidate.id)}
                      className={styles.radio}
                    />
                    <CandidatePhoto candidate={candidate} />
                    <div className={styles.candidateInfo}>
                      <span className={styles.candidateName}>{candidate.name}</span>
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

          {submitError && <Alert type="error">{submitError}</Alert>}

          {candidates.length > 0 && (
            <div className={styles.modalFooter}>
              <Button
                variant="primary"
                disabled={!selected}
                onClick={() => {
                  setSubmitError('');
                  setStep('confirm');
                }}
              >
                Voter pour ce poste
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * RESULTS MODAL
 * ──────────────────────────────────────────────────────────────────────── */

function ResultsModal({ post, onClose }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await apiClient.get(
          `/elections/${post.electionId}/positions/${post.id}/result`
        );
        if (active) setResult(data.result || data);
      } catch (err) {
        if (!active) return;
        if (err.status === 403) {
          setError('Les résultats ne sont pas encore disponibles pour ce poste.');
        } else {
          setError('Impossible de charger les résultats.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [post.electionId, post.id]);

  const candidates = result?.candidates || [];
  const totalVotes =
    result?.votesCast ??
    candidates.reduce((sum, c) => sum + (c.count || 0), 0);
  const chartData = candidates.map((c) => ({
    label: c.name,
    value: c.count || 0,
    photo_ref: c.photo_ref || null,
  }));

  return (
    <Modal open title={post.name} onClose={onClose}>
      {loading ? (
        <Spinner label="Chargement des résultats..." />
      ) : error ? (
        <Alert type="error">{error}</Alert>
      ) : (
        <div className={styles.resultsBox}>
          {renderWindow(post) && (
            <div className={styles.resultsHeader}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className={styles.resultsWindow}>{renderWindow(post)}</span>
            </div>
          )}
          {totalVotes === 0 ? (
            <EmptyState
              icon="📊"
              title="Aucun vote"
              text="Aucun vote enregistré pour ce poste."
            />
          ) : (
            <VotePieChart data={chartData} size={220} />
          )}
        </div>
      )}
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * SHARED HELPERS
 * ──────────────────────────────────────────────────────────────────────── */

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

function LogoImage({ src, alt, className }) {
  const [failed, setFailed] = useState(false);
  const initial = (alt || '?').trim().charAt(0).toUpperCase();

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={className}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className={`${className} ${styles.logoFallback}`} aria-hidden="true">
      {initial}
    </span>
  );
}

function renderWindow(post) {
  const start = post.start_at || post.startAt;
  const end = post.end_at || post.endAt;
  const tz = post.schedule_timezone || post.electionTimezone;
  if (!start || !end) return null;
  const s = formatDisplayTime(start, tz);
  const e = formatDisplayTime(end, tz);
  return `${s.text} → ${e.text} (${s.zoneLabel})`;
}

function formatStart(post) {
  const start = post.start_at || post.startAt;
  const tz = post.schedule_timezone || post.electionTimezone;
  if (!start) return '';
  const s = formatDisplayTime(start, tz);
  return `${s.text} (${s.zoneLabel})`;
}
