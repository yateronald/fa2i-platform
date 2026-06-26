'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/apiClient';
import { parseParticipantFile } from '@/lib/participantImport';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Alert } from '@/components/ui/Alert';
import styles from './members.module.css';

/**
 * Association — "Membres" management page.
 *
 * Lists the members of the caller's association and lets an authorized
 * caller (association manager, or an election manager allowed to manage
 * members) add members one at a time, import them from a CSV/Excel file or
 * remove them. The backend scopes every operation to the caller's own
 * association, so no association id needs to be sent.
 */
export default function MembersPage() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pagination
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [success, setSuccess] = useState('');

  // Add modal state
  const [addOpen, setAddOpen] = useState(false);
  const [aFullName, setAFullName] = useState('');
  const [aEmail, setAEmail] = useState('');
  const [aPhone, setAPhone] = useState('');
  const [aError, setAError] = useState('');
  const [adding, setAdding] = useState(false);

  // Import modal state
  const [importOpen, setImportOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [previewRows, setPreviewRows] = useState([]); // [{ fullName, email }]
  const [importError, setImportError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  // Delete confirm state
  const [deleteMember, setDeleteMember] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [dError, setDError] = useState('');

  // Edit modal state
  const [editMember, setEditMember] = useState(null);
  const [eFullName, setEFullName] = useState('');
  const [eEmail, setEEmail] = useState('');
  const [ePhone, setEPhone] = useState('');
  const [eError, setEError] = useState('');
  const [editing, setEditing] = useState(false);

  // Enable/disable state (tracks the member currently being toggled)
  const [togglingId, setTogglingId] = useState(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/members');
      setMembers(data.members || []);
      setError('');
    } catch (err) {
      if (err.status === 401) {
        window.location.href = '/login';
        return;
      }
      setError('Erreur lors du chargement des membres.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  /* ── Add a single member ─────────────────────────────────── */
  function openAdd() {
    setAFullName('');
    setAEmail('');
    setAPhone('');
    setAError('');
    setSuccess('');
    setError('');
    setAddOpen(true);
  }

  async function submitAdd(e) {
    e.preventDefault();
    setAError('');
    if (!aFullName.trim() || !aEmail.trim()) {
      setAError('Le nom complet et l’email sont requis.');
      return;
    }
    setAdding(true);
    try {
      const res = await apiClient.post('/members', {
        email: aEmail.trim(),
        fullName: aFullName.trim(),
        phone: aPhone.trim(),
      });
      setAddOpen(false);
      await fetchMembers();
      if (res && res.existingAccount && !res.created) {
        setSuccess(
          'Membre ajouté. Cette personne possède déjà un compte ; elle doit se connecter avec son mot de passe actuel.'
        );
      } else {
        setSuccess('Membre ajouté. Un mot de passe temporaire a été envoyé par email.');
      }
    } catch (err) {
      if (err.status === 409) {
        setAError(err.body?.error || 'Cette personne est déjà membre.');
      } else if (err.body?.errors) {
        setAError(err.body.errors.join(', '));
      } else {
        setAError(err.body?.error || err.message || 'Échec de l’ajout du membre.');
      }
    } finally {
      setAdding(false);
    }
  }

  /* ── Import members from file ────────────────────────────── */
  function openImport() {
    setFileName('');
    setPreviewRows([]);
    setImportError('');
    setSuccess('');
    setError('');
    setImportOpen(true);
  }

  async function handleFileChange(e) {
    const file = e.target.files && e.target.files[0];
    setImportError('');
    setPreviewRows([]);
    if (!file) {
      setFileName('');
      return;
    }
    setFileName(file.name);
    setParsing(true);
    try {
      const { rows, error: parseErr } = await parseParticipantFile(file);
      if (parseErr) {
        setImportError(parseErr);
        return;
      }
      if (!rows || rows.length === 0) {
        setImportError('Aucune ligne de membre trouvée dans le fichier.');
        return;
      }
      // Association column is ignored for members; phone is optional.
      setPreviewRows(rows.map((r) => ({ fullName: r.fullName, email: r.email, phone: r.phone || '' })));
    } catch (err) {
      setImportError(err.message || 'Échec de la lecture du fichier.');
    } finally {
      setParsing(false);
    }
  }

  async function submitImport() {
    if (previewRows.length === 0) return;
    setImportError('');
    setImporting(true);
    try {
      const res = await apiClient.post('/members/bulk', {
        members: previewRows.map((r) => ({ email: r.email, fullName: r.fullName, phone: r.phone || '' })),
      });
      const summary = res.summary || { added: 0, reused: 0, duplicates: 0, failed: [] };
      const failedCount = Array.isArray(summary.failed) ? summary.failed.length : 0;
      setImportOpen(false);
      await fetchMembers();
      setSuccess(
        `${summary.added} créé(s) et notifié(s). ${summary.reused} compte(s) existant(s). ` +
          `${summary.duplicates} déjà membre(s). ${failedCount} échec(s).`
      );
    } catch (err) {
      setImportError(err.body?.error || err.message || 'Échec de l’import des membres.');
    } finally {
      setImporting(false);
    }
  }

  /* ── Edit a member (modify name / email) ─────────────────── */
  function openEdit(m) {
    setEditMember(m);
    setEFullName(m.full_name || '');
    setEEmail(m.email || '');
    setEPhone(m.phone || '');
    setEError('');
    setSuccess('');
    setError('');
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editMember) return;
    setEError('');
    if (!eFullName.trim() || !eEmail.trim()) {
      setEError('Le nom complet et l’email sont requis.');
      return;
    }
    const emailChanged = eEmail.trim().toLowerCase() !== (editMember.email || '').toLowerCase();
    setEditing(true);
    try {
      await apiClient.patch(`/members/${editMember.user_id}`, {
        fullName: eFullName.trim(),
        email: eEmail.trim(),
        phone: ePhone.trim(),
      });
      setEditMember(null);
      await fetchMembers();
      setSuccess(
        emailChanged
          ? 'Membre mis à jour. Comme l’email a changé, un nouveau mot de passe temporaire a été envoyé.'
          : 'Membre mis à jour.'
      );
    } catch (err) {
      if (err.status === 409) {
        setEError(err.body?.error || 'Cet email est déjà utilisé');
      } else if (err.body?.errors) {
        setEError(err.body.errors.join(', '));
      } else {
        setEError(err.body?.error || err.message || 'Échec de la mise à jour du membre.');
      }
    } finally {
      setEditing(false);
    }
  }

  /* ── Enable / disable a member ───────────────────────────── */
  async function toggleActive(m) {
    setError('');
    setSuccess('');
    setTogglingId(m.user_id);
    try {
      await apiClient.patch(`/members/${m.user_id}`, { isActive: !m.is_active });
      await fetchMembers();
      setSuccess(m.is_active ? 'Membre désactivé.' : 'Membre activé.');
    } catch (err) {
      if (err.status === 404) {
        setError('Membre introuvable.');
      } else {
        setError(err.body?.error || err.message || 'Échec de la mise à jour du statut.');
      }
    } finally {
      setTogglingId(null);
    }
  }

  /* ── Delete a member ─────────────────────────────────────── */
  async function confirmDelete() {
    if (!deleteMember) return;
    setDError('');
    setDeleting(true);
    try {
      await apiClient.delete(`/members/${deleteMember.user_id}`);
      setDeleteMember(null);
      await fetchMembers();
      setSuccess('Membre supprimé.');
    } catch (err) {
      if (err.status === 404) {
        setDError('Membre introuvable.');
      } else {
        setDError(err.body?.error || err.message || 'Erreur lors de la suppression.');
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.page}>
      <Card>
        <CardHeader
          title="Membres de l’association"
          subtitle={
            members.length > 0
              ? `${members.length} membre${members.length > 1 ? 's' : ''}`
              : 'Gérez les membres de votre association.'
          }
          action={
            <div className={styles.actions}>
              <Button onClick={openAdd}>+ Ajouter un membre</Button>
              <Button variant="outline" onClick={openImport}>
                Importer (CSV / Excel)
              </Button>
            </div>
          }
        />

        {success && <Alert type="success">{success}</Alert>}
        {error && <Alert>{error}</Alert>}

        <p className={styles.helperNote}>
          Les membres désactivés ne peuvent plus se connecter ni voter, et ne sont pas proposés
          lors de l’ajout de participants.
        </p>

        {loading ? (
          <Spinner label="Chargement des membres..." />
        ) : members.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Aucun membre"
            text="Ajoutez un premier membre, individuellement ou par import de fichier."
          />
        ) : (
          <div className={styles.tableContainer}>
            {/* Fixed header */}
            <div className={styles.tableHeaderWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>Nom complet</th>
                    <th style={{ width: '26%' }}>Email</th>
                    <th style={{ width: '10%' }}>Téléphone</th>
                    <th style={{ width: '9%' }}>Statut</th>
                    <th style={{ width: '16%' }}>Ajouté le</th>
                    <th style={{ width: '17%' }} className={styles.actionsCol}>Actions</th>
                  </tr>
                </thead>
              </table>
            </div>

            {/* Scrollable body only */}
            <div className={styles.tableBodyWrap}>
              <table className={styles.table}>
                <colgroup>
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '26%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '17%' }} />
                </colgroup>
                <tbody>
                  {members
                    .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                    .map((m) => (
                    <tr key={m.user_id} className={m.is_active ? undefined : styles.disabledRow}>
                      <td data-label="Nom complet">
                        <span className={styles.name}>{m.full_name || '—'}</span>
                        {m.is_temporary_password && (
                          <span className={styles.tempPwd} title="Mot de passe temporaire non encore changé">
                            Mot de passe temporaire
                          </span>
                        )}
                      </td>
                      <td className={styles.emailCell} data-label="Email">{m.email}</td>
                      <td className={styles.emailCell} data-label="Téléphone">{m.phone || '—'}</td>
                      <td data-label="Statut">
                        {m.is_active ? (
                          <Badge variant="open">Actif</Badge>
                        ) : (
                          <Badge variant="closed">Désactivé</Badge>
                        )}
                      </td>
                      <td className={styles.dateCell} data-label="Ajouté le">
                        {m.added_at
                          ? new Date(m.added_at).toLocaleDateString('fr-FR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                            }) + ' ' +
                            new Date(m.added_at).toLocaleTimeString('fr-FR', {
                              hour: '2-digit', minute: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td data-label="Actions">
                        <div className={styles.actions}>
                          <button
                            className={`${styles.actionBtn} ${styles.actionBtnEdit}`}
                            onClick={() => openEdit(m)}
                            title="Modifier ce membre"
                          >
                            ✎ Modifier
                          </button>
                          <button
                            className={`${styles.actionBtn} ${m.is_active ? styles.actionBtnToggle : styles.actionBtnActivate}`}
                            onClick={() => toggleActive(m)}
                            disabled={togglingId === m.user_id}
                            title={m.is_active ? 'Désactiver ce membre' : 'Activer ce membre'}
                          >
                            {togglingId === m.user_id
                              ? '⋯'
                              : m.is_active
                              ? '○ Désactiver'
                              : '● Activer'}
                          </button>
                          <button
                            className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                            onClick={() => {
                              setDError('');
                              setDeleteMember(m);
                            }}
                            title="Supprimer ce membre"
                          >
                            ✕ Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination controls */}
            {members.length > PAGE_SIZE && (
              <div className={styles.pagination}>
                <span className={styles.paginationInfo}>
                  {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, members.length)} sur {members.length} membres
                </span>
                <div className={styles.paginationButtons}>
                  <button
                    className={styles.pageBtn}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    aria-label="Page précédente"
                  >
                    ‹
                  </button>
                  {Array.from({ length: Math.ceil(members.length / PAGE_SIZE) }, (_, i) => i + 1)
                    .filter((page) => {
                      const total = Math.ceil(members.length / PAGE_SIZE);
                      return page === 1 || page === total ||
                        (page >= currentPage - 1 && page <= currentPage + 1);
                    })
                    .reduce((acc, page, idx, arr) => {
                      if (idx > 0 && page - arr[idx - 1] > 1) {
                        acc.push('...');
                      }
                      acc.push(page);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === '...' ? (
                        <span key={`ellipsis-${idx}`} className={styles.pageEllipsis}>…</span>
                      ) : (
                        <button
                          key={item}
                          className={`${styles.pageBtn} ${currentPage === item ? styles.pageBtnActive : ''}`}
                          onClick={() => setCurrentPage(item)}
                          aria-label={`Page ${item}`}
                          aria-current={currentPage === item ? 'page' : undefined}
                        >
                          {item}
                        </button>
                      )
                    )}
                  <button
                    className={styles.pageBtn}
                    onClick={() => setCurrentPage((p) => Math.min(Math.ceil(members.length / PAGE_SIZE), p + 1))}
                    disabled={currentPage === Math.ceil(members.length / PAGE_SIZE)}
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

      {/* Add member modal */}
      <Modal open={addOpen} title="Ajouter un membre" onClose={() => setAddOpen(false)}>
        <form onSubmit={submitAdd} className={styles.form}>
          {aError && <Alert>{aError}</Alert>}
          <Field label="Nom complet" htmlFor="m-fullname">
            <Input
              id="m-fullname"
              value={aFullName}
              onChange={(e) => setAFullName(e.target.value)}
              placeholder="Ex. Awa Diop"
              required
              maxLength={120}
            />
          </Field>
          <Field
            label="Email"
            hint="Un mot de passe temporaire sera envoyé si un compte est créé."
            htmlFor="m-email"
          >
            <Input
              id="m-email"
              type="email"
              value={aEmail}
              onChange={(e) => setAEmail(e.target.value)}
              placeholder="exemple@domaine.com"
              required
              maxLength={254}
            />
          </Field>
          <Field
            label="Numéro de téléphone (facultatif)"
            htmlFor="m-phone"
          >
            <Input
              id="m-phone"
              type="tel"
              value={aPhone}
              onChange={(e) => setAPhone(e.target.value)}
              placeholder="Ex. +91 98765 43210"
              maxLength={30}
            />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" disabled={adding}>
              {adding ? 'Ajout...' : 'Ajouter le membre'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Annuler
            </Button>
          </div>
        </form>
      </Modal>

      {/* Import modal */}
      <Modal
        open={importOpen}
        title="Importer des membres (CSV / Excel)"
        onClose={() => setImportOpen(false)}
        size="lg"
      >
        <div className={styles.form}>
          {importError && <Alert>{importError}</Alert>}
          <p className={styles.muted}>
            Colonnes attendues : « Nom complet », « Email ». La colonne « Téléphone » est
            facultative et la colonne « Association » est ignorée.
          </p>
          <div className={styles.importControls}>
            <label className={styles.fileLabel}>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                className={styles.fileInput}
                disabled={parsing || importing}
              />
              <span className={styles.fileButton}>Choisir un fichier</span>
              <span className={styles.fileName}>{fileName || 'Aucun fichier sélectionné'}</span>
            </label>
          </div>

          {parsing && <Spinner label="Lecture du fichier..." />}

          {previewRows.length > 0 && (
            <div className={styles.previewBlock}>
              <div className={styles.previewSummary}>
                <Badge variant="neutral">{previewRows.length} ligne(s)</Badge>
              </div>
              <div className={styles.previewTableWrap}>
                <table className={styles.previewTable}>
                  <thead>
                    <tr>
                      <th className={styles.previewColName}>Nom complet</th>
                      <th className={styles.previewColEmail}>Email</th>
                      <th className={styles.previewColPhone}>Téléphone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={`${r.email || 'row'}-${i}`}>
                        <td>{r.fullName || <span className={styles.muted}>—</span>}</td>
                        <td>{r.email || <span className={styles.muted}>—</span>}</td>
                        <td>{r.phone || <span className={styles.muted}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className={styles.formActions}>
            <Button
              type="button"
              onClick={submitImport}
              disabled={importing || previewRows.length === 0}
            >
              {importing ? 'Import...' : `Importer ${previewRows.length} membre(s)`}
            </Button>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>
              Annuler
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit member modal */}
      <Modal open={!!editMember} title="Modifier le membre" onClose={() => setEditMember(null)}>
        {editMember && (
          <form onSubmit={submitEdit} className={styles.form}>
            {eError && <Alert>{eError}</Alert>}
            <Field label="Nom complet" htmlFor="m-edit-fullname">
              <Input
                id="m-edit-fullname"
                value={eFullName}
                onChange={(e) => setEFullName(e.target.value)}
                placeholder="Ex. Awa Diop"
                required
                maxLength={120}
              />
            </Field>
            <Field
              label="Email"
              hint="Si l’email change, un nouveau mot de passe temporaire sera envoyé."
              htmlFor="m-edit-email"
            >
              <Input
                id="m-edit-email"
                type="email"
                value={eEmail}
                onChange={(e) => setEEmail(e.target.value)}
                placeholder="exemple@domaine.com"
                required
                maxLength={254}
              />
            </Field>
            <Field label="Numéro de téléphone (facultatif)" htmlFor="m-edit-phone">
              <Input
                id="m-edit-phone"
                type="tel"
                value={ePhone}
                onChange={(e) => setEPhone(e.target.value)}
                placeholder="Ex. +91 98765 43210"
                maxLength={30}
              />
            </Field>
            <div className={styles.formActions}>
              <Button type="submit" disabled={editing}>
                {editing ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditMember(null)}>
                Annuler
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={!!deleteMember} title="Supprimer le membre" onClose={() => setDeleteMember(null)}>
        {deleteMember && (
          <div className={styles.form}>
            {dError && <Alert>{dError}</Alert>}
            <p>
              Êtes-vous sûr de vouloir supprimer{' '}
              <strong>{deleteMember.full_name || deleteMember.email}</strong> de la liste des
              membres ? Il sera également retiré de toutes les élections où il figure. Cette
              action est irréversible.
            </p>
            <div className={styles.formActions}>
              <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Suppression...' : 'Supprimer'}
              </Button>
              <Button variant="outline" onClick={() => setDeleteMember(null)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
