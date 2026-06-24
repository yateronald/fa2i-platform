'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './MemberPicker.module.css';

/**
 * Reusable picker that adds an association's ACTIVE members as voters of an
 * election. It is the single supported way to add voters from the association
 * side (no manual entry, no CSV). Submits to:
 *   POST /elections/:electionId/participants/from-members
 *
 * Members already added to the election (existingIds) are shown disabled with a
 * "Déjà ajouté" badge so they can't be re-selected.
 *
 * @param {object} props
 * @param {string} props.electionId
 * @param {Set<string>} [props.existingIds] - user_ids already participating.
 * @param {number|null} [props.remaining] - optional quota cap on how many more
 *   may be added; when set, selecting beyond it is blocked with a warning.
 * @param {(summary: object) => void|Promise<void>} props.onDone
 * @param {() => void} props.onCancel
 */
export default function MemberPicker({ electionId, existingIds, remaining, onDone, onCancel }) {
  const alreadyAddedIds = existingIds instanceof Set ? existingIds : new Set();
  const hasQuota = typeof remaining === 'number' && Number.isFinite(remaining);

  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');
  const selectAllRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const data = await apiClient.get('/members');
        if (!active) return;
        setMembers(data.members || []);
      } catch (err) {
        if (!active) return;
        setError(err.body?.error || err.message || 'Échec du chargement des membres.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const activeMembers = useMemo(() => members.filter((m) => m.is_active), [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeMembers;
    return activeMembers.filter((m) =>
      [m.full_name || '', m.email || '', m.phone || ''].some((v) =>
        v.toLowerCase().includes(q)
      )
    );
  }, [activeMembers, query]);

  const selectableFiltered = useMemo(
    () => filtered.filter((m) => !alreadyAddedIds.has(m.user_id)),
    [filtered, alreadyAddedIds]
  );
  const alreadyAddedCount = useMemo(
    () => activeMembers.reduce((n, m) => n + (alreadyAddedIds.has(m.user_id) ? 1 : 0), 0),
    [activeMembers, alreadyAddedIds]
  );
  const filteredSelectedCount = useMemo(
    () => filtered.reduce((n, m) => n + (selected.has(m.user_id) ? 1 : 0), 0),
    [filtered, selected]
  );
  const allFilteredSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((m) => selected.has(m.user_id));
  const someFilteredSelected = filteredSelectedCount > 0 && !allFilteredSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredSelected;
  }, [someFilteredSelected, filtered.length]);

  const overQuota = hasQuota && selected.size > Math.max(0, remaining);

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        selectableFiltered.forEach((m) => next.delete(m.user_id));
      } else {
        selectableFiltered.forEach((m) => next.add(m.user_id));
      }
      return next;
    });
  }

  function toggleOne(userId) {
    if (alreadyAddedIds.has(userId)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleSubmit() {
    if (selected.size === 0 || overQuota) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await apiClient.post(`/elections/${electionId}/participants/from-members`, {
        userIds: Array.from(selected),
      });
      await onDone(res.summary);
    } catch (err) {
      setError(err.body?.error || err.message || 'Échec de l’ajout des membres.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.memberPicker}>
      {error && <Alert>{error}</Alert>}

      {loading ? (
        <Spinner label="Chargement des membres..." />
      ) : activeMembers.length === 0 ? (
        <EmptyState
          icon="👥"
          title="Aucun membre actif"
          text="Aucun membre actif n’est disponible. Ajoutez d’abord des membres à votre association."
        />
      ) : (
        <>
          {hasQuota && (
            <p className={styles.memberNote}>
              {remaining > 0
                ? `Vous pouvez encore ajouter ${remaining} votant(s) pour cette élection.`
                : 'Le quota de votants de votre association est atteint pour cette élection.'}
            </p>
          )}

          <div className={styles.memberSearchRow}>
            <span className={styles.memberSearchIcon} aria-hidden="true">🔍</span>
            <input
              type="search"
              className={styles.memberSearch}
              placeholder="Rechercher par nom, email ou téléphone..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Rechercher un membre"
            />
          </div>

          <div className={styles.memberToolbar}>
            <label className={styles.memberSelectAll}>
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleAllFiltered}
                disabled={selectableFiltered.length === 0}
              />
              <span>{query ? 'Sélectionner les résultats' : 'Tout sélectionner'}</span>
            </label>
            <span className={styles.memberCount}>
              <strong>{selected.size}</strong> sélectionné{selected.size > 1 ? 's' : ''}
              {alreadyAddedCount > 0 && (
                <> {' · '}{alreadyAddedCount} déjà ajouté{alreadyAddedCount > 1 ? 's' : ''}</>
              )}
              {' · '}
              {filtered.length} / {activeMembers.length} affiché{activeMembers.length > 1 ? 's' : ''}
            </span>
          </div>

          {overQuota && (
            <Alert>
              Vous avez sélectionné {selected.size} votant(s) mais il ne reste que {Math.max(0, remaining)}{' '}
              place(s). Réduisez votre sélection.
            </Alert>
          )}

          <div className={styles.memberList} role="group" aria-label="Liste des membres actifs">
            {filtered.length === 0 ? (
              <p className={styles.memberNoResult}>Aucun membre ne correspond à « {query} ».</p>
            ) : (
              filtered.map((m) => {
                const added = alreadyAddedIds.has(m.user_id);
                const isSel = !added && selected.has(m.user_id);
                const initial = (m.full_name || m.email || '?').charAt(0).toUpperCase();
                return (
                  <label
                    key={m.user_id}
                    className={`${styles.memberItem} ${
                      added ? styles.memberItemDisabled : isSel ? styles.memberItemSelected : ''
                    }`}
                    title={added ? 'Ce membre est déjà inscrit à cette élection' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={added ? true : isSel}
                      onChange={() => toggleOne(m.user_id)}
                      disabled={added}
                    />
                    <span className={styles.memberAvatar} aria-hidden="true">
                      {initial}
                    </span>
                    <span className={styles.memberInfo}>
                      <span className={styles.memberName}>{m.full_name || '—'}</span>
                      <span className={styles.memberEmail}>
                        {m.email}
                        {m.phone ? ` · ${m.phone}` : ''}
                      </span>
                    </span>
                    {added && <span className={styles.memberBadgeAdded}>Déjà ajouté</span>}
                  </label>
                );
              })
            )}
          </div>

          <div className={styles.memberActions}>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || selected.size === 0 || overQuota}
            >
              {submitting ? 'Ajout...' : `Ajouter la sélection (${selected.size})`}
            </Button>
            {selected.size > 0 && (
              <Button type="button" variant="ghost" onClick={clearSelection} disabled={submitting}>
                Effacer
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onCancel}>
              Annuler
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
