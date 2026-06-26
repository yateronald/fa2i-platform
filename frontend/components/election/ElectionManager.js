'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { getCurrentUser } from '@/lib/session';
import { readFileAsDataURL } from '@/lib/fileUtils';
import { resolveMediaUrl } from '@/lib/media';
import { parseParticipantFile } from '@/lib/participantImport';
import {
  formatDisplayTime,
  detectTimezone,
  commonTimezones,
  zonedWallTimeToUTCISO,
  utcISOToZonedWallTime,
} from '@/lib/timezone';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StateBadge } from '@/components/ui/Badge';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import MemberPicker from '@/components/members/MemberPicker';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './ElectionManager.module.css';

const TABS = [
  { id: 'details', label: 'Détails' },
  { id: 'positions', label: 'Postes & candidats' },
  { id: 'participants', label: 'Participants' },
];

function windowLabel(startAt, endAt, tz) {
  if (!startAt || !endAt) return null;
  const start = formatDisplayTime(startAt, tz);
  const end = formatDisplayTime(endAt, tz);
  return `${start.text} → ${end.text} (${start.zoneLabel})`;
}

/**
 * Ownership gate for modify/delete of an election. Only the creator may modify
 * or delete it. Legacy elections (created_by === null) fall back to allowing the
 * viewer — the backend re-checks role/scope authorization for those rows.
 */
function ownsElection(user, election) {
  if (!user || !election) return false;
  if (election.created_by == null) return true;
  return user.id === election.created_by;
}

/**
 * Ownership gate for modify/delete of a candidate. Only the creator may modify
 * or delete it. Legacy candidates (created_by === null) fall back to the backend
 * role check.
 */
function ownsCandidate(user, cand) {
  if (!user || !cand) return false;
  if (cand.created_by == null) return true;
  return user.id === cand.created_by;
}

export default function ElectionManager({ electionId }) {
  const router = useRouter();

  const [election, setElection] = useState(null);
  const [positions, setPositions] = useState([]);
  const [associations, setAssociations] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [activeTab, setActiveTab] = useState('details');

  // Modal state: 'position' | 'candidate' | 'publish' | 'participant' | 'bulk' | 'members'
  const [modal, setModal] = useState(null);
  const [activePositionId, setActivePositionId] = useState(null);
  const [activeCandidate, setActiveCandidate] = useState(null);
  const [membersBusy, setMembersBusy] = useState(false);

  // Pagination for participants table
  const PART_PAGE_SIZE = 10;
  const [partPage, setPartPage] = useState(1);

  // Confirmation dialog state. `confirm.action` is the async function run when
  // the user clicks the confirm button.
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  // ----- Data fetching helpers -----

  const refreshPositions = useCallback(async () => {
    // Single request returns positions WITH their candidates (avoids N+1).
    const res = await apiClient.get(
      `/elections/${electionId}/positions?include=candidates`
    );
    const withCandidates = (res.positions || []).map((p) => ({
      ...p,
      candidates: p.candidates || [],
    }));
    setPositions(withCandidates);
  }, [electionId]);

  const refreshCandidates = useCallback(
    async (positionId) => {
      try {
        const res = await apiClient.get(
          `/elections/${electionId}/positions/${positionId}/candidates`
        );
        setPositions((prev) =>
          prev.map((p) =>
            p.id === positionId ? { ...p, candidates: res.candidates || [] } : p
          )
        );
      } catch {
        // leave existing candidates in place on failure
      }
    },
    [electionId]
  );

  const refreshParticipants = useCallback(async () => {
    const res = await apiClient.get(`/elections/${electionId}/participants`);
    setParticipants(res.participants || []);
  }, [electionId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const electionRes = await apiClient.get(`/elections/${electionId}`);
      const el = electionRes.election;
      setElection(el);

      const positionsRes = await apiClient.get(
        `/elections/${electionId}/positions?include=candidates`
      );
      const withCandidates = (positionsRes.positions || []).map((p) => ({
        ...p,
        candidates: p.candidates || [],
      }));
      setPositions(withCandidates);

      const partRes = await apiClient.get(`/elections/${electionId}/participants`);
      setParticipants(partRes.participants || []);

      if (el.scope === 'FEDERATION') {
        try {
          const assocRes = await apiClient.get('/associations');
          setAssociations(assocRes.associations || []);
        } catch {
          setAssociations([]);
        }
      }
    } catch (err) {
      setError(err.message || "Erreur lors du chargement de l'élection");
    } finally {
      setLoading(false);
    }
  }, [electionId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((u) => {
        if (active) setCurrentUser(u);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // ----- Modal controls -----

  function openPositionModal() {
    setActivePositionId(null);
    setModal('position');
  }

  function openCandidateModal(positionId) {
    setActivePositionId(positionId);
    setActiveCandidate(null);
    setModal('candidate');
  }

  function openEditCandidateModal(positionId, candidate) {
    setActivePositionId(positionId);
    setActiveCandidate(candidate);
    setModal('editCandidate');
  }

  function openPublishModal(positionId) {
    setActivePositionId(positionId);
    setModal('publish');
  }

  function closeModal() {
    setModal(null);
    setActivePositionId(null);
    setActiveCandidate(null);
  }

  // ----- Confirmation dialog -----

  function requestConfirm(config) {
    setConfirmError('');
    setConfirm(config);
  }

  function cancelConfirm() {
    if (confirmBusy) return;
    setConfirm(null);
    setConfirmError('');
  }

  async function proceedConfirm() {
    if (!confirm || !confirm.action) return;
    setConfirmBusy(true);
    setConfirmError('');
    try {
      await confirm.action();
      setConfirm(null);
    } catch (err) {
      setConfirmError(err.body?.error || err.message || 'Une erreur est survenue.');
    } finally {
      setConfirmBusy(false);
    }
  }

  // ----- Mutating actions (invoked from the confirmation dialog) -----

  async function doDeleteElection() {
    setError('');
    setSuccess('');
    await apiClient.delete(`/elections/${electionId}`);
    router.push(
      election.scope === 'FEDERATION'
        ? '/federation/elections'
        : `/association/${election.association_id}/elections`
    );
  }

  async function doDeleteCandidate(positionId, candidate) {
    setError('');
    setSuccess('');
    await apiClient.delete(
      `/elections/${electionId}/positions/${positionId}/candidates/${candidate.id}`
    );
    await refreshCandidates(positionId);
  }

  async function doRemoveParticipant(participant) {
    setError('');
    setSuccess('');
    await apiClient.delete(`/elections/${electionId}/participants/${participant.user_id}`);
    await refreshParticipants();
    setSuccess('Votant retiré de l’élection.');
  }

  function handleDeleteElection() {
    requestConfirm({
      title: "Supprimer l'élection",
      message:
        'Supprimer définitivement cette élection ? Postes, candidats et participants seront également supprimés. Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
      action: doDeleteElection,
    });
  }

  function handleDeleteCandidate(positionId, candidate) {
    requestConfirm({
      title: 'Supprimer le candidat',
      message: `Supprimer le candidat « ${candidate.name} » ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
      action: () => doDeleteCandidate(positionId, candidate),
    });
  }

  function handleRemoveParticipant(participant) {
    requestConfirm({
      title: 'Retirer le votant',
      message: `Retirer ${participant.full_name || participant.email} de cette élection ?`,
      confirmLabel: 'Retirer',
      variant: 'danger',
      action: () => doRemoveParticipant(participant),
    });
  }

  function buildMembersSummaryMessage(summary) {
    const added = summary?.added || 0;
    const duplicates = summary?.duplicates || 0;
    return `${added} ajouté(s), ${duplicates} déjà participant(s).`;
  }

  function handleAddAllMembers() {
    requestConfirm({
      title: 'Ajouter tous les membres',
      message: 'Ajouter tous les membres actifs comme participants de cette élection ?',
      confirmLabel: 'Ajouter',
      variant: 'primary',
      action: async () => {
        setError('');
        setSuccess('');
        setMembersBusy(true);
        try {
          const res = await apiClient.post(
            `/elections/${electionId}/participants/from-members`,
            { all: true }
          );
          await refreshParticipants();
          setSuccess(buildMembersSummaryMessage(res.summary));
        } finally {
          setMembersBusy(false);
        }
      },
    });
  }

  // ----- Render -----

  if (loading) {
    return <Spinner label="Chargement de l'élection..." />;
  }

  if (error && !election) {
    return <Alert>{error}</Alert>;
  }

  if (!election) {
    return <Alert>Élection introuvable.</Alert>;
  }

  const isFederation = election.scope === 'FEDERATION';
  const scopeLabel = isFederation ? 'Élection fédérale' : "Élection d'association";
  const mgmtWindow = windowLabel(election.start_at, election.end_at, election.schedule_timezone);
  const electionEnded = election.end_at ? new Date() >= new Date(election.end_at) : false;

  return (
    <div className={styles.manager}>
      {error && <Alert>{error}</Alert>}

      {/* Header card (always visible) */}
      <Card>
        <CardHeader
          title={election.name}
          subtitle={scopeLabel}
          action={
            <div className={styles.headerActions}>
              <StateBadge state={election.state} />
              <Button
                variant="outline"
                onClick={() => router.push(`/elections/${electionId}/dashboard`)}
              >
                Voir les résultats
              </Button>
              {ownsElection(currentUser, election) && !electionEnded && (
                <Button variant="outline" onClick={() => setModal('editElection')}>
                  Modifier
                </Button>
              )}
              {ownsElection(currentUser, election) && (
                <Button variant="danger" onClick={handleDeleteElection}>
                  Supprimer
                </Button>
              )}
            </div>
          }
        />
        {mgmtWindow && (
          <div className={styles.headerWindow}>
            <span className={styles.windowIcon} aria-hidden="true">🗓️</span>
            <span>Période de gestion : {mgmtWindow}</span>
          </div>
        )}
      </Card>

      {/* Tab bar */}
      <div className={styles.tabBar} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'details' && (
        <DetailsTab
          election={election}
          scopeLabel={scopeLabel}
          mgmtWindow={mgmtWindow}
        />
      )}

      {activeTab === 'positions' && (
        <PositionsTab
          positions={positions}
          electionEnded={electionEnded}
          currentUser={currentUser}
          onAddPosition={openPositionModal}
          onAddCandidate={openCandidateModal}
          onEditCandidate={openEditCandidateModal}
          onDeleteCandidate={handleDeleteCandidate}
          onPublish={openPublishModal}
        />
      )}

      {activeTab === 'participants' && (
        <ParticipantsTab
          election={election}
          isFederation={isFederation}
          participants={participants}
          associations={associations}
          electionId={electionId}
          success={success}
          onAdd={() => setModal('participant')}
          onBulk={() => setModal('bulk')}
          onFromMembers={() => setModal('members')}
          onAllMembers={handleAddAllMembers}
          onRemoveParticipant={handleRemoveParticipant}
          membersBusy={membersBusy}
          partPage={partPage}
          setPartPage={setPartPage}
          partPageSize={PART_PAGE_SIZE}
        />
      )}

      {/* Modals */}
      <Modal open={modal === 'position'} title="Ajouter un poste" onClose={closeModal}>
        <AddPositionForm
          electionId={electionId}
          onSuccess={async () => {
            await refreshPositions();
            closeModal();
          }}
          onCancel={closeModal}
        />
      </Modal>

      <Modal open={modal === 'candidate'} title="Ajouter un candidat" onClose={closeModal}>
        <AddCandidateForm
          electionId={electionId}
          positionId={activePositionId}
          onSuccess={async () => {
            await refreshCandidates(activePositionId);
            closeModal();
          }}
          onCancel={closeModal}
        />
      </Modal>

      <Modal open={modal === 'editElection'} title="Modifier l'élection" onClose={closeModal}>
        <EditElectionForm
          electionId={electionId}
          election={election}
          isFederation={isFederation}
          onSuccess={async () => {
            await loadAll();
            setSuccess('Élection mise à jour.');
            closeModal();
          }}
          onCancel={closeModal}
        />
      </Modal>

      <Modal open={modal === 'editCandidate'} title="Modifier le candidat" onClose={closeModal}>
        <EditCandidateForm
          electionId={electionId}
          positionId={activePositionId}
          candidate={activeCandidate}
          onSuccess={async () => {
            await refreshCandidates(activePositionId);
            closeModal();
          }}
          onCancel={closeModal}
        />
      </Modal>

      <Modal open={modal === 'publish'} title="Publier le poste" onClose={closeModal}>
        <PublishPositionForm
          electionId={electionId}
          election={election}
          position={positions.find((p) => p.id === activePositionId) || null}
          onSuccess={async () => {
            await refreshPositions();
            closeModal();
          }}
          onCancel={closeModal}
        />
      </Modal>

      <Modal open={modal === 'participant'} title="Ajouter un participant" onClose={closeModal}>
        <AddParticipantForm
          electionId={electionId}
          isFederation={isFederation}
          associations={associations}
          onSuccess={async (res) => {
            await refreshParticipants();
            if (res && res.existingAccount && !res.created) {
              setSuccess(
                'Participant ajouté. Cet utilisateur possède déjà un compte ; il doit se connecter avec son mot de passe actuel.'
              );
            } else {
              setSuccess(
                'Participant ajouté. Un mot de passe temporaire a été envoyé par email.'
              );
            }
            closeModal();
          }}
          onCancel={closeModal}
        />
      </Modal>

      <Modal open={modal === 'bulk'} title="Importer des participants (CSV ou Excel)" onClose={closeModal}>
        <BulkImportForm
          electionId={electionId}
          isFederation={isFederation}
          associations={associations}
          onDone={async () => {
            await refreshParticipants();
          }}
          onClose={closeModal}
        />
      </Modal>

      <Modal open={modal === 'members'} title="Ajouter depuis les membres" onClose={closeModal}>
        <MemberPicker
          electionId={electionId}
          existingIds={new Set(participants.map((p) => p.user_id))}
          onDone={async (summary) => {
            await refreshParticipants();
            setSuccess(buildMembersSummaryMessage(summary));
            closeModal();
          }}
          onCancel={closeModal}
        />
      </Modal>

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={confirm?.confirmLabel}
        variant={confirm?.variant}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={proceedConfirm}
        onCancel={cancelConfirm}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────

function DetailsTab({ election, scopeLabel, mgmtWindow }) {
  return (
    <Card>
      <CardHeader title="Détails de l'élection" />
      <dl className={styles.detailGrid}>
        <div className={styles.detailItem}>
          <dt className={styles.detailLabel}>Portée</dt>
          <dd className={styles.detailValue}>{scopeLabel}</dd>
        </div>
        <div className={styles.detailItem}>
          <dt className={styles.detailLabel}>Période de gestion</dt>
          <dd className={styles.detailValue}>{mgmtWindow || '—'}</dd>
        </div>
        <div className={styles.detailItem}>
          <dt className={styles.detailLabel}>État</dt>
          <dd className={styles.detailValue}>
            <StateBadge state={election.state} />
          </dd>
        </div>
      </dl>
      <p className={styles.modelHint}>
        La période de gestion permet d'ajouter les postes et les participants. Chaque poste
        possède sa propre fenêtre de vote.
      </p>
    </Card>
  );
}

function PositionsTab({ positions, electionEnded, currentUser, onAddPosition, onAddCandidate, onEditCandidate, onDeleteCandidate, onPublish }) {
  return (
    <Card>
      <CardHeader
        title="Postes & candidats"
        subtitle="Chaque poste possède sa propre fenêtre de vote."
        action={
          <Button onClick={onAddPosition} disabled={electionEnded}>
            Ajouter un poste
          </Button>
        }
      />

      {electionEnded && (
        <p className={styles.modelHint}>
          L'élection est terminée. Les postes et les candidats ne peuvent plus être modifiés.
        </p>
      )}

      {positions.length === 0 ? (
        <EmptyState
          icon="🗳️"
          title="Aucun poste"
          text="Ajoutez un poste pour commencer à organiser cette élection."
        />
      ) : (
        <div className={styles.positionListWrap}>
          <div className={styles.positionList}>
            {positions.map((pos) => {
            const isDraft = pos.state === 'DRAFT' || !pos.published;
            const voteWindow = windowLabel(pos.start_at, pos.end_at, pos.schedule_timezone);
            return (
              <div key={pos.id} className={styles.positionBlock}>
                <div className={styles.positionHeader}>
                  <div className={styles.positionTitleRow}>
                    <span className={styles.positionName}>{pos.name}</span>
                    <StateBadge state={pos.state} />
                  </div>
                  <div className={styles.toolbar}>
                    {isDraft ? (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => onAddCandidate(pos.id)}
                          disabled={electionEnded}
                        >
                          Ajouter un candidat
                        </Button>
                        <Button
                          onClick={() => onPublish(pos.id)}
                          disabled={electionEnded || !pos.candidates || pos.candidates.length === 0}
                          title={(!pos.candidates || pos.candidates.length === 0) ? "Veuillez ajouter au moins un candidat avant de publier." : undefined}
                        >
                          Publier
                        </Button>
                      </>
                    ) : (
                      pos.state === 'PENDING' &&
                      !electionEnded && (
                        <Button variant="outline" onClick={() => onPublish(pos.id)}>
                          Modifier la fenêtre
                        </Button>
                      )
                    )}
                  </div>
                </div>

                {!isDraft && voteWindow && (
                  <div className={styles.positionWindow}>Vote : {voteWindow}</div>
                )}

                {!isDraft && (
                  <p className={styles.noCandidates}>Candidats verrouillés (poste publié).</p>
                )}

                {(!pos.candidates || pos.candidates.length === 0) ? (
                  isDraft && (
                    <p className={styles.noCandidates}>Aucun candidat pour ce poste.</p>
                  )
                ) : (
                  <div className={styles.candidateList}>
                    {pos.candidates.map((cand) => {
                      const photoUrl = resolveMediaUrl(cand.photo_ref);

                      return (
                        <div key={cand.id} className={styles.candidateRow}>
                          {photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={styles.candidatePhoto}
                              src={photoUrl}
                              alt={cand.name}
                            />
                          ) : (
                            <div className={styles.candidatePhotoPlaceholder} aria-hidden="true">
                              {cand.name?.charAt(0) || '?'}
                            </div>
                          )}
                          <div className={styles.candidateInfo}>
                            <span className={styles.candidateName}>{cand.name}</span>
                            {cand.motivation && (
                              <span className={styles.candidateMotivation}>{cand.motivation}</span>
                            )}
                          </div>
                          {isDraft && !electionEnded && ownsCandidate(currentUser, cand) && (
                            <div className={styles.candidateActions}>
                              <Button
                                variant="ghost"
                                onClick={() => onEditCandidate(pos.id, cand)}
                              >
                                Modifier
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => onDeleteCandidate(pos.id, cand)}
                              >
                                Supprimer
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </Card>
  );
}

function ParticipantsTab({
  election,
  isFederation,
  participants,
  associations,
  electionId,
  success,
  onAdd,
  onBulk,
  onFromMembers,
  onAllMembers,
  onRemoveParticipant,
  membersBusy,
  partPage,
  setPartPage,
  partPageSize,
}) {
  const quota =
    isFederation && typeof election.voters_per_association === 'number'
      ? election.voters_per_association
      : null;

  return (
    <div className={styles.tabStack}>
      <Card>
        <CardHeader
          title="Participants"
          subtitle="Électeurs autorisés à voter sur cette élection."
          action={
            <div className={styles.toolbar}>
              {isFederation ? (
                <>
                  <Button onClick={onAdd}>Ajouter un participant</Button>
                  <Button variant="outline" onClick={onBulk}>
                    Importer (CSV / Excel)
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={onFromMembers} disabled={membersBusy}>
                    Ajouter depuis les membres
                  </Button>
                  <Button variant="outline" onClick={onAllMembers} disabled={membersBusy}>
                    {membersBusy ? 'Ajout...' : 'Tous les membres'}
                  </Button>
                </>
              )}
            </div>
          }
        />

        {quota !== null && (
          <div className={styles.quotaBanner}>
            <span className={styles.windowIcon} aria-hidden="true">👤</span>
            <span>
              Quota par association : <strong>{quota}</strong> votant{quota > 1 ? 's' : ''} maximum.
            </span>
          </div>
        )}

        {success && <Alert type="success">{success}</Alert>}

        {participants.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Aucun participant"
            text={
              isFederation
                ? 'Ajoutez les électeurs autorisés à voter, individuellement ou par import de fichier.'
                : 'Ajoutez les électeurs depuis la liste des membres de votre association.'
            }
          />
        ) : (
          <div className={styles.tableContainer}>
            {/* Fixed column header */}
            <div className={styles.tableHeaderWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: '20%' }}>Nom complet</th>
                    <th style={{ width: '28%' }}>Email</th>
                    <th style={{ width: '16%' }}>Association</th>
                    <th style={{ width: '10%' }}>Rôle</th>
                    <th style={{ width: '16%' }}>Ajouté le</th>
                    <th style={{ width: '10%' }}>Actions</th>
                  </tr>
                </thead>
              </table>
            </div>

            {/* Scrollable rows */}
            <div className={styles.tableBodyWrap}>
              <table className={styles.table}>
                <colgroup>
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '28%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <tbody>
                  {participants
                    .slice((partPage - 1) * partPageSize, partPage * partPageSize)
                    .map((p) => (
                    <tr key={p.user_id}>
                      <td data-label="Nom complet">{p.full_name || '—'}</td>
                      <td data-label="Email">{p.email}</td>
                      <td data-label="Association" className={styles.tableMuted}>{p.association_name || '—'}</td>
                      <td data-label="Rôle">{p.role ? <Badge variant="neutral">{p.role}</Badge> : '—'}</td>
                      <td data-label="Ajouté le" className={styles.tableMuted}>
                        {p.added_at
                          ? formatDisplayTime(p.added_at, election.schedule_timezone).text
                          : '—'}
                      </td>
                      <td data-label="Actions">
                        <Button size="sm" variant="ghost" onClick={() => onRemoveParticipant(p)}>
                          Retirer
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {participants.length > partPageSize && (
              <div className={styles.pagination}>
                <span className={styles.paginationInfo}>
                  {(partPage - 1) * partPageSize + 1}–{Math.min(partPage * partPageSize, participants.length)} sur {participants.length} participants
                </span>
                <div className={styles.paginationButtons}>
                  <button
                    className={styles.pageBtn}
                    onClick={() => setPartPage((p) => Math.max(1, p - 1))}
                    disabled={partPage === 1}
                    aria-label="Page précédente"
                  >
                    ‹
                  </button>
                  {Array.from({ length: Math.ceil(participants.length / partPageSize) }, (_, i) => i + 1)
                    .filter((page) => {
                      const total = Math.ceil(participants.length / partPageSize);
                      return page === 1 || page === total || (page >= partPage - 1 && page <= partPage + 1);
                    })
                    .reduce((acc, page, idx, arr) => {
                      if (idx > 0 && page - arr[idx - 1] > 1) acc.push('...');
                      acc.push(page);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === '...' ? (
                        <span key={`ellipsis-${idx}`} className={styles.pageEllipsis}>…</span>
                      ) : (
                        <button
                          key={item}
                          className={`${styles.pageBtn} ${partPage === item ? styles.pageBtnActive : ''}`}
                          onClick={() => setPartPage(item)}
                          aria-label={`Page ${item}`}
                          aria-current={partPage === item ? 'page' : undefined}
                        >
                          {item}
                        </button>
                      )
                    )}
                  <button
                    className={styles.pageBtn}
                    onClick={() => setPartPage((p) => Math.min(Math.ceil(participants.length / partPageSize), p + 1))}
                    disabled={partPage === Math.ceil(participants.length / partPageSize)}
                    aria-label="Page suivante"
                  >
                    ›
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Forms
// ─────────────────────────────────────────────────────────────────

function AddPositionForm({ electionId, onSuccess, onCancel }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.post(`/elections/${electionId}/positions`, { name });
      await onSuccess();
    } catch (err) {
      const msg = err.body?.errors ? err.body.errors.join(', ') : err.message || 'Erreur';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      <Field
        label="Nom du poste"
        htmlFor="posname"
        hint="Le poste est créé en brouillon. Vous définirez sa fenêtre de vote lors de la publication."
      >
        <Input
          id="posname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Ex: Président"
        />
      </Field>
      <div className={styles.formActions}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Ajout...' : 'Ajouter'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function PublishPositionForm({ electionId, election, position, onSuccess, onCancel }) {
  const isEditing = position?.state === 'PENDING' || position?.published;
  const defaultTz =
    position?.schedule_timezone || election?.schedule_timezone || detectTimezone();

  const [timezone, setTimezone] = useState(defaultTz);
  const [start, setStart] = useState(
    position?.start_at ? utcISOToZonedWallTime(position.start_at, defaultTz) : ''
  );
  const [end, setEnd] = useState(
    position?.end_at ? utcISOToZonedWallTime(position.end_at, defaultTz) : ''
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const tzOptions = commonTimezones();
  const allowedWindow = windowLabel(
    election?.start_at,
    election?.end_at,
    election?.schedule_timezone
  );

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (!position) {
      setError('Poste introuvable.');
      return;
    }
    if (!isEditing && (!position.candidates || position.candidates.length === 0)) {
      setError('Le poste doit avoir au moins un candidat pour être publié.');
      return;
    }
    if (!start || !end) {
      setError("Veuillez renseigner l'ouverture et la clôture du vote.");
      return;
    }
    const startISO = zonedWallTimeToUTCISO(start, timezone);
    const endISO = zonedWallTimeToUTCISO(end, timezone);
    if (new Date(endISO) <= new Date(startISO)) {
      setError('La clôture doit être postérieure à l\'ouverture.');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post(
        `/elections/${electionId}/positions/${position.id}/publish`,
        { start: startISO, end: endISO, timezone }
      );
      await onSuccess();
    } catch (err) {
      const msg = err.body?.error
        || (err.body?.errors ? err.body.errors.join(', ') : null)
        || err.message
        || 'Erreur';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      {allowedWindow && (
        <p className={styles.modelHint}>
          La fenêtre doit être comprise dans la période de l'élection : {allowedWindow}.
        </p>
      )}
      <Field label="Fuseau horaire" htmlFor="pubtz">
        <select
          id="pubtz"
          className={styles.select}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ouverture du vote" htmlFor="pubstart">
        <Input
          id="pubstart"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
        />
      </Field>
      <Field
        label="Clôture du vote"
        htmlFor="pubend"
        hint="Définissez la fenêtre de vote propre à ce poste."
      >
        <Input
          id="pubend"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          required
        />
      </Field>
      <div className={styles.formActions}>
        <Button type="submit" disabled={loading}>
          {loading
            ? 'Enregistrement...'
            : isEditing
            ? 'Mettre à jour la fenêtre'
            : 'Publier'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function AddCandidateForm({ electionId, positionId, onSuccess, onCancel }) {
  const [name, setName] = useState('');
  const [motivation, setMotivation] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!photoFile) {
      setError('La photo est requise');
      return;
    }
    setLoading(true);
    try {
      const { dataUrl, mimeType, size } = await readFileAsDataURL(photoFile);
      await apiClient.post(`/elections/${electionId}/positions/${positionId}/candidates`, {
        name,
        motivation,
        photo: dataUrl,
        photoMimeType: mimeType,
        photoSize: size,
      });
      await onSuccess();
    } catch (err) {
      const msg = err.body?.errors ? err.body.errors.join(', ') : err.message || 'Erreur';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      <Field label="Nom" htmlFor="candname">
        <Input id="candname" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Motivation" htmlFor="candmot">
        <Textarea
          id="candmot"
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          placeholder="Présentation et motivation du candidat"
        />
      </Field>
      <Field label="Photo (JPEG/PNG, ≤5 Mo)" htmlFor="candphoto">
        <Input
          id="candphoto"
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => setPhotoFile(e.target.files[0])}
          required
        />
      </Field>
      <div className={styles.formActions}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Ajout...' : 'Ajouter'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function EditElectionForm({ electionId, election, isFederation, onSuccess, onCancel }) {
  const defaultTz = election?.schedule_timezone || detectTimezone();
  const [name, setName] = useState(election?.name || '');
  const [timezone, setTimezone] = useState(defaultTz);
  const [start, setStart] = useState(
    election?.start_at ? utcISOToZonedWallTime(election.start_at, defaultTz) : ''
  );
  const [end, setEnd] = useState(
    election?.end_at ? utcISOToZonedWallTime(election.end_at, defaultTz) : ''
  );
  const [votersPerAssociation, setVotersPerAssociation] = useState(
    isFederation && election?.voters_per_association != null
      ? String(election.voters_per_association)
      : ''
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const tzOptions = commonTimezones();

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError("Le nom de l'élection est requis.");
      return;
    }
    if (!start || !end) {
      setError("Veuillez renseigner l'ouverture et la clôture.");
      return;
    }
    const startISO = zonedWallTimeToUTCISO(start, timezone);
    const endISO = zonedWallTimeToUTCISO(end, timezone);
    if (new Date(endISO) <= new Date(startISO)) {
      setError('La clôture doit être postérieure à l’ouverture.');
      return;
    }

    const payload = { name: name.trim(), start: startISO, end: endISO, timezone };
    if (isFederation) {
      payload.votersPerAssociation =
        votersPerAssociation === '' ? null : Number(votersPerAssociation);
    }

    setLoading(true);
    try {
      await apiClient.patch(`/elections/${electionId}`, payload);
      await onSuccess();
    } catch (err) {
      const msg = err.body?.errors
        ? err.body.errors.join(', ')
        : err.body?.error || err.message || 'Erreur';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      <Field label="Nom de l'élection" htmlFor="editname">
        <Input id="editname" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Fuseau horaire" htmlFor="edittz">
        <select
          id="edittz"
          className={styles.select}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ouverture de la période de gestion" htmlFor="editstart">
        <Input
          id="editstart"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
        />
      </Field>
      <Field label="Clôture de la période de gestion" htmlFor="editend">
        <Input
          id="editend"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          required
        />
      </Field>
      {isFederation && (
        <Field
          label="Quota de votants par association"
          htmlFor="editquota"
          hint="Laisser vide pour aucun quota."
        >
          <Input
            id="editquota"
            type="number"
            min="1"
            value={votersPerAssociation}
            onChange={(e) => setVotersPerAssociation(e.target.value)}
          />
        </Field>
      )}
      <div className={styles.formActions}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Enregistrement...' : 'Enregistrer'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function EditCandidateForm({ electionId, positionId, candidate, onSuccess, onCancel }) {
  const [name, setName] = useState(candidate?.name || '');
  const [motivation, setMotivation] = useState(candidate?.motivation || '');
  const [photoFile, setPhotoFile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = { name, motivation };
      if (photoFile) {
        const { dataUrl, mimeType, size } = await readFileAsDataURL(photoFile);
        payload.photo = dataUrl;
        payload.photoMimeType = mimeType;
        payload.photoSize = size;
      }
      await apiClient.patch(
        `/elections/${electionId}/positions/${positionId}/candidates/${candidate.id}`,
        payload
      );
      await onSuccess();
    } catch (err) {
      const msg = err.body?.errors
        ? err.body.errors.join(', ')
        : err.body?.error || err.message || 'Erreur';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      <Field label="Nom" htmlFor="editcandname">
        <Input
          id="editcandname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <Field label="Motivation" htmlFor="editcandmot">
        <Textarea
          id="editcandmot"
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          placeholder="Présentation et motivation du candidat"
        />
      </Field>
      <Field
        label="Remplacer la photo (JPEG/PNG, ≤5 Mo)"
        htmlFor="editcandphoto"
        hint="Laisser vide pour conserver la photo actuelle."
      >
        <Input
          id="editcandphoto"
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => setPhotoFile(e.target.files[0])}
        />
      </Field>
      <div className={styles.formActions}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Enregistrement...' : 'Enregistrer'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function AddParticipantForm({ electionId, isFederation, associations, onSuccess, onCancel }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [associationId, setAssociationId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = { email, fullName };
      if (isFederation && associationId) {
        payload.associationId = associationId;
      }
      const res = await apiClient.post(`/elections/${electionId}/participants`, payload);
      await onSuccess(res);
    } catch (err) {
      if (err.status === 409) {
        setError('Ce participant est déjà inscrit à cette élection.');
      } else {
        const msg = err.body?.errors ? err.body.errors.join(', ') : err.message || 'Erreur';
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Alert>{error}</Alert>
      <Field label="Nom complet" htmlFor="partname">
        <Input
          id="partname"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </Field>
      <Field label="Email" htmlFor="partemail">
        <Input
          id="partemail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      {isFederation && (
        <Field label="Association" htmlFor="partassoc">
          <select
            id="partassoc"
            className={styles.select}
            value={associationId}
            onChange={(e) => setAssociationId(e.target.value)}
          >
            <option value="">—</option>
            {associations.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className={styles.formActions}>
        <Button type="submit" disabled={loading}>
          {loading ? 'Ajout...' : 'Ajouter'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function normalizeName(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function BulkImportForm({ electionId, isFederation, associations, onDone, onClose }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // { rows, summary }
  const [created, setCreated] = useState(null); // summary after creation
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);

  const assocByName = useMemo(() => {
    const m = new Map();
    associations.forEach((a) => m.set(normalizeName(a.name), a.id));
    return m;
  }, [associations]);

  async function handleValidate(e) {
    e.preventDefault();
    setError('');
    setPreview(null);
    setCreated(null);

    if (!file) {
      setError('Veuillez sélectionner un fichier CSV ou Excel.');
      return;
    }

    setParsing(true);
    try {
      const { rows, error: parseError } = await parseParticipantFile(file);
      if (parseError) {
        setError(parseError);
        return;
      }
      if (!rows || rows.length === 0) {
        setError('Le fichier ne contient aucune ligne de participant.');
        return;
      }

      const payloadRows = rows.map((r) => ({
        fullName: r.fullName,
        email: r.email,
        associationId: isFederation
          ? assocByName.get(normalizeName(r.association)) || null
          : null,
      }));

      const res = await apiClient.post(`/elections/${electionId}/participants/validate`, {
        participants: payloadRows,
      });

      // Merge the original association label back in for display.
      const merged = (res.rows || []).map((rr, i) => ({
        ...rr,
        association: rows[i] ? rows[i].association : '',
      }));

      setPreview({ rows: merged, summary: res.summary || { valid: 0, invalid: 0 } });
    } catch (err) {
      const msg = err.body?.errors ? err.body.errors.join(', ') : err.message || 'Erreur';
      setError(msg);
    } finally {
      setParsing(false);
    }
  }

  async function handleCreate() {
    if (!preview) return;
    setError('');
    setCreating(true);
    try {
      const validRows = preview.rows
        .filter((r) => r.valid)
        .map((r) => ({
          fullName: r.fullName,
          email: r.email,
          associationId: r.associationId || undefined,
        }));

      const res = await apiClient.post(`/elections/${electionId}/participants/bulk`, {
        participants: validRows,
      });

      setCreated(res.summary || null);
      setPreview(null);
      await onDone();
    } catch (err) {
      const msg = err.body?.errors ? err.body.errors.join(', ') : err.message || 'Erreur';
      setError(msg);
    } finally {
      setCreating(false);
    }
  }

  function resetFile(selected) {
    setFile(selected);
    setPreview(null);
    setCreated(null);
    setError('');
  }

  const validCount = preview?.summary?.valid ?? 0;

  return (
    <div>
      <Alert>{error}</Alert>

      {created ? (
        <div className={styles.summaryBox}>
          <p className={styles.summaryLine}>
            {created.added} compte{created.added > 1 ? 's' : ''} créé
            {created.added > 1 ? 's' : ''} et notifié{created.added > 1 ? 's' : ''} par email.
            {created.reused > 0 && (
              <> {created.reused} compte{created.reused > 1 ? 's' : ''} existant
                {created.reused > 1 ? 's' : ''} ajouté{created.reused > 1 ? 's' : ''} (mot de passe actuel).</>
            )}
            {created.duplicates > 0 && (
              <> {created.duplicates} doublon{created.duplicates > 1 ? 's' : ''} ignoré
                {created.duplicates > 1 ? 's' : ''}.</>
            )}
            {(created.failed?.length || 0) > 0 && (
              <> {created.failed.length} échec{created.failed.length > 1 ? 's' : ''}.</>
            )}
          </p>
          {created.failed?.length > 0 && (
            <ul className={styles.summaryFailed}>
              {created.failed.map((f, i) => (
                <li key={`${f.email}-${i}`}>
                  {f.email} : {f.error}
                </li>
              ))}
            </ul>
          )}
          <p className={styles.modelHint} style={{ marginTop: '0.75rem' }}>
            Les comptes nouvellement créés ont reçu un mot de passe temporaire par email. Les
            comptes existants doivent se connecter avec leur mot de passe actuel.
          </p>
          <div className={styles.formActions}>
            <Button type="button" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      ) : (
        <>
          <form onSubmit={handleValidate}>
            <Field
              label="Fichier de participants (CSV ou Excel)"
              htmlFor="bulkfile"
              hint={
                isFederation
                  ? 'Colonnes attendues : "Nom complet", "Email", "Association".'
                  : 'Colonnes attendues : "Nom complet", "Email", "Association" (l\'association est ignorée pour une élection d\'association).'
              }
            >
              <Input
                id="bulkfile"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => resetFile(e.target.files[0] || null)}
              />
            </Field>

            <div className={styles.formActions}>
              <Button type="submit" disabled={parsing || !file}>
                {parsing ? 'Analyse...' : 'Vérifier le fichier'}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Fermer
              </Button>
            </div>
          </form>

          {preview && (
            <div style={{ marginTop: '1.25rem' }}>
              <div className={styles.summaryBox}>
                <p className={styles.summaryLine}>
                  {preview.summary.valid} ligne{preview.summary.valid > 1 ? 's' : ''} valide
                  {preview.summary.valid > 1 ? 's' : ''}, {preview.summary.invalid} invalide
                  {preview.summary.invalid > 1 ? 's' : ''}.
                </p>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Nom complet</th>
                      <th>Email</th>
                      {isFederation && <th>Association</th>}
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={`${r.email || 'row'}-${i}`}>
                        <td data-label="Nom complet">{r.fullName || '—'}</td>
                        <td data-label="Email">{r.email || '—'}</td>
                        {isFederation && <td data-label="Association">{r.association || '—'}</td>}
                        <td data-label="Statut">
                          {r.valid ? (
                            <span className={styles.invalidCell}>
                              <Badge variant="open">Valide</Badge>
                              {r.existing && (
                                <span className={styles.invalidError}>Compte existant</span>
                              )}
                            </span>
                          ) : (
                            <span className={styles.invalidCell}>
                              <Badge variant="warn">Invalide</Badge>
                              <span className={styles.invalidError}>{r.error}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.formActions}>
                <Button type="button" onClick={handleCreate} disabled={creating || validCount === 0}>
                  {creating
                    ? 'Création...'
                    : `Créer ${validCount} participant${validCount > 1 ? 's' : ''}`}
                </Button>
                <Button type="button" variant="outline" onClick={onClose}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
