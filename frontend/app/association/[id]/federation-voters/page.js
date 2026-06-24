'use client';

import { useState, useEffect, useCallback, useMemo, use } from 'react';
import { apiClient } from '@/lib/apiClient';
import { getCurrentUser } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StateBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Alert } from '@/components/ui/Alert';
import MemberPicker from '@/components/members/MemberPicker';
import styles from './federation-voters.module.css';

/**
 * Association Manager — "Électeurs fédération" portal (FE-3).
 *
 * For a federation election, each local association declares which of its
 * members may vote. Voters can ONLY be added by selecting from the association's
 * member roster (no manual entry, no CSV import). A per-association quota
 * (voters_per_association) is enforced both client-side (to guide the manager)
 * and server-side (authoritative).
 *
 * The manager can only add voters for their OWN association: the association id
 * is derived from the session.
 */
export default function FederationVotersPage({ params }) {
  const { id } = use(params);

  const [associationName, setAssociationName] = useState('');

  const [elections, setElections] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Member-picker modal state
  const [pickerOpen, setPickerOpen] = useState(false);

  // Voter-list ("Liste des votants") state
  const [votersShown, setVotersShown] = useState(false);
  const [voters, setVoters] = useState([]);
  const [votersLoading, setVotersLoading] = useState(false);
  const [votersError, setVotersError] = useState('');

  const loadElections = useCallback(async () => {
    const data = await apiClient.get('/federation-elections');
    setElections(data.elections || []);
    return data.elections || [];
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const [, list, assoc] = await Promise.all([
          getCurrentUser(),
          loadElections(),
          apiClient.get(`/associations/${id}`).catch(() => null),
        ]);
        if (!active) return;
        if (assoc && assoc.association) setAssociationName(assoc.association.name || '');
        if (list.length > 0) setSelectedId((prev) => prev || list[0].id);
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
        setError('Erreur lors du chargement des élections de la fédération.');
      } finally {
        if (active) setLoading(false);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, [id, loadElections]);

  const selectedElection = useMemo(
    () => elections.find((e) => e.id === selectedId) || null,
    [elections, selectedId]
  );

  const quota = selectedElection ? selectedElection.voters_per_association : null;
  const used = selectedElection ? selectedElection.usedByAssociation || 0 : 0;
  const hasQuota = typeof quota === 'number' && quota > 0;
  const remaining = hasQuota ? Math.max(0, quota - used) : Infinity;
  const quotaReached = hasQuota && remaining <= 0;
  const quotaPct = hasQuota ? Math.min(100, Math.round((used / quota) * 100)) : 0;

  const refreshQuota = useCallback(async () => {
    try {
      await loadElections();
    } catch {
      /* keep current view on refresh error */
    }
  }, [loadElections]);

  const fetchVoters = useCallback(async (electionId) => {
    if (!electionId) return [];
    setVotersLoading(true);
    setVotersError('');
    try {
      const data = await apiClient.get(`/federation-elections/${electionId}/my-voters`);
      setVoters(data.voters || []);
      return data.voters || [];
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return [];
      }
      setVotersError(err.message || 'Échec du chargement de la liste des votants.');
      return [];
    } finally {
      setVotersLoading(false);
    }
  }, []);

  // user_ids already added for this association — used to mark members as "Déjà ajouté".
  const existingVoterIds = useMemo(
    () => new Set(voters.map((v) => v.user_id)),
    [voters]
  );

  async function handleToggleVoters() {
    if (!selectedElection) return;
    if (votersShown) {
      setVotersShown(false);
      return;
    }
    setVotersShown(true);
    await fetchVoters(selectedElection.id);
  }

  function handleSelect(electionId) {
    setSelectedId(electionId);
    setSuccess('');
    setVotersShown(false);
    setVoters([]);
    setVotersError('');
  }

  async function openPicker() {
    if (!selectedElection) return;
    setSuccess('');
    // Load current voters so already-added members are marked in the picker.
    await fetchVoters(selectedElection.id);
    setPickerOpen(true);
  }

  async function handlePickerDone(summary) {
    setPickerOpen(false);
    const added = summary?.added || 0;
    const duplicates = summary?.duplicates || 0;
    const skipped = summary?.skippedQuota || 0;
    let msg = `${added} votant(s) ajouté(s).`;
    if (duplicates) msg += ` ${duplicates} déjà inscrit(s).`;
    if (skipped) msg += ` ${skipped} ignoré(s) (quota atteint).`;
    setSuccess(msg);
    await refreshQuota();
    await fetchVoters(selectedElection.id);
  }

  return (
    <div className={styles.page}>
      <Card>
        <CardHeader
          title="Électeurs fédération"
          subtitle="Ajoutez les votants de votre association à une élection de la fédération, depuis vos membres."
        />
        {associationName && (
          <p className={styles.assocLine}>
            Association : <strong>{associationName}</strong>
          </p>
        )}
      </Card>

      {loading ? (
        <Spinner label="Chargement des élections de la fédération..." />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : elections.length === 0 ? (
        <Card>
          <EmptyState
            icon="🏛️"
            title="Aucune élection de la fédération"
            text="Aucune élection fédérale n’est disponible pour le moment."
          />
        </Card>
      ) : (
        <>
          {/* Election picker */}
          <Card>
            <CardHeader title="Choisir une élection" />
            <div className={styles.electionList}>
              {elections.map((election) => {
                const isActive = election.id === selectedId;
                const eUsed = election.usedByAssociation || 0;
                const eQuota = election.voters_per_association;
                const eHasQuota = typeof eQuota === 'number' && eQuota > 0;
                return (
                  <button
                    key={election.id}
                    type="button"
                    onClick={() => handleSelect(election.id)}
                    className={`${styles.electionCard} ${isActive ? styles.electionCardActive : ''}`}
                    aria-pressed={isActive}
                  >
                    <div className={styles.electionTop}>
                      <span className={styles.electionName}>{election.name}</span>
                      <StateBadge state={election.state} />
                    </div>
                    <div className={styles.electionMeta}>
                      {eHasQuota ? (
                        <Badge variant={eUsed >= eQuota ? 'warn' : 'neutral'}>
                          Quota : {eUsed} / {eQuota}
                        </Badge>
                      ) : (
                        <Badge variant="neutral">Sans quota</Badge>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {selectedElection && (
            <>
              {success && <Alert type="success">{success}</Alert>}

              {/* Quota usage */}
              <Card>
                <CardHeader title={`Quota — ${selectedElection.name}`} />
                {hasQuota ? (
                  <div className={styles.quotaBox}>
                    <div className={styles.quotaHead}>
                      <span className={styles.quotaText}>
                        {used} / {quota} votants utilisés
                      </span>
                      <span
                        className={`${styles.remaining} ${quotaReached ? styles.remainingZero : ''}`}
                      >
                        {quotaReached ? 'Quota atteint' : `${remaining} place(s) restante(s)`}
                      </span>
                    </div>
                    <div
                      className={styles.quotaBar}
                      role="progressbar"
                      aria-valuenow={used}
                      aria-valuemin={0}
                      aria-valuemax={quota}
                    >
                      <div
                        className={`${styles.quotaBarFill} ${quotaReached ? styles.quotaBarFull : ''}`}
                        style={{ width: `${quotaPct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className={styles.muted}>
                    Cette élection n’impose pas de quota par association : {used} votant(s) déjà
                    ajouté(s).
                  </p>
                )}
              </Card>

              {/* Add voters from members */}
              <Card>
                <CardHeader
                  title="Ajouter des votants"
                  subtitle="Les votants sont sélectionnés parmi les membres de votre association."
                  action={
                    <Button onClick={openPicker} disabled={quotaReached}>
                      Ajouter depuis les membres
                    </Button>
                  }
                />
                {quotaReached && (
                  <Alert>
                    Le quota de votants de votre association est atteint pour cette élection.
                  </Alert>
                )}
                <p className={styles.muted}>
                  Pour ajouter une personne qui n’est pas encore membre, ajoutez-la d’abord à la
                  liste des membres de votre association.
                </p>
              </Card>

              {/* Voter list */}
              <Card>
                <div className={styles.listHead}>
                  <CardHeader title={`Liste des votants — ${selectedElection.name}`} />
                  <Button variant="secondary" onClick={handleToggleVoters} disabled={votersLoading}>
                    {votersShown ? 'Masquer la liste' : 'Voir la liste'}
                  </Button>
                </div>

                {votersShown && (
                  <>
                    {votersError && <Alert>{votersError}</Alert>}
                    {votersLoading ? (
                      <Spinner label="Chargement de la liste des votants..." />
                    ) : voters.length === 0 ? (
                      <EmptyState
                        icon="🗳️"
                        title="Aucun votant"
                        text="Aucun votant de votre association n’est encore inscrit pour cette élection."
                      />
                    ) : (
                      <div className={styles.previewBlock}>
                        <div className={styles.previewSummary}>
                          <Badge variant="neutral">{voters.length} votant(s)</Badge>
                        </div>
                        <div className={styles.tableWrap}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>Nom complet</th>
                                <th>Email</th>
                                <th>Ajouté le</th>
                              </tr>
                            </thead>
                            <tbody>
                              {voters.map((v) => (
                                <tr key={v.user_id}>
                                  <td>{v.full_name || <span className={styles.muted}>—</span>}</td>
                                  <td>{v.email || <span className={styles.muted}>—</span>}</td>
                                  <td>
                                    {v.added_at
                                      ? new Date(v.added_at).toLocaleString('fr-FR')
                                      : <span className={styles.muted}>—</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Card>
            </>
          )}
        </>
      )}

      {/* Member picker modal */}
      <Modal
        open={pickerOpen}
        title="Ajouter des votants depuis les membres"
        onClose={() => setPickerOpen(false)}
      >
        {selectedElection && (
          <MemberPicker
            electionId={selectedElection.id}
            existingIds={existingVoterIds}
            remaining={hasQuota ? remaining : undefined}
            onDone={handlePickerDone}
            onCancel={() => setPickerOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
}
