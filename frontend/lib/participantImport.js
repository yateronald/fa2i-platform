/**
 * participantImport
 *
 * Shared, self-contained helper for importing participant rows from a
 * spreadsheet file (CSV or .xlsx). Used by the federation/association
 * participant-import flows (FE-1 shared lib, reused by FE-2 and FE-3).
 *
 * The expected columns use French headers and the parser is tolerant of
 * case, surrounding whitespace and accents:
 *   - "Nom complet"  -> fullName
 *   - "Email"        -> email
 *   - "Association"  -> association
 *
 * Usage:
 *   const { rows, error } = await parseParticipantFile(file);
 *   if (error) { ...show error... } else { ...use rows... }
 *
 * Each returned row has the shape: { fullName, email, association, phone }.
 * Values are trimmed; fully-empty rows are skipped. The "phone" column is
 * optional. If any required column is missing from the header, a clear error
 * string is returned instead of rows.
 */

import * as XLSX from 'xlsx';

/**
 * Normalize a header cell for tolerant matching:
 * lowercase, strip accents/diacritics, collapse whitespace.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeHeader(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/\s+/g, ' ');
}

/**
 * Map of normalized header text -> canonical field name.
 * Multiple aliases are accepted per field for robustness.
 */
const HEADER_ALIASES = {
  'nom complet': 'fullName',
  nom: 'fullName',
  'full name': 'fullName',
  'fullname': 'fullName',
  email: 'email',
  'e-mail': 'email',
  courriel: 'email',
  association: 'association',
  asso: 'association',
  telephone: 'phone',
  tel: 'phone',
  phone: 'phone',
  'phone number': 'phone',
  numero: 'phone',
  'numero de telephone': 'phone',
  'numero telephone': 'phone',
  mobile: 'phone',
  portable: 'phone',
};

const REQUIRED_FIELDS = ['fullName', 'email', 'association'];

const REQUIRED_FIELD_LABELS = {
  fullName: 'Nom complet',
  email: 'Email',
  association: 'Association',
};

/**
 * Parse a participant import File (CSV or .xlsx) into normalized rows.
 *
 * @param {File} file - The uploaded file (CSV or XLSX).
 * @returns {Promise<{ rows: Array<{ fullName: string, email: string, association: string }>, error?: string }>}
 */
export async function parseParticipantFile(file) {
  if (!file) {
    return { rows: [], error: 'Aucun fichier fourni' };
  }

  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    // `type: 'array'` works for both .xlsx and .csv binary content.
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch {
    return { rows: [], error: 'Impossible de lire le fichier. Formats acceptés : CSV ou Excel (.xlsx).' };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], error: 'Le fichier ne contient aucune feuille de données.' };
  }
  const sheet = workbook.Sheets[sheetName];

  // Read as a matrix of rows so we can map headers ourselves (tolerant matching).
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  if (!matrix || matrix.length === 0) {
    return { rows: [], error: 'Le fichier est vide.' };
  }

  // First non-empty row is the header.
  const headerRowIndex = matrix.findIndex(
    (row) => Array.isArray(row) && row.some((c) => String(c).trim() !== '')
  );
  if (headerRowIndex === -1) {
    return { rows: [], error: 'Le fichier est vide.' };
  }

  const headerRow = matrix[headerRowIndex];

  // Build a map: canonical field -> column index.
  const fieldToCol = {};
  headerRow.forEach((cell, colIdx) => {
    const field = HEADER_ALIASES[normalizeHeader(cell)];
    if (field && fieldToCol[field] === undefined) {
      fieldToCol[field] = colIdx;
    }
  });

  // Validate required columns are present.
  const missing = REQUIRED_FIELDS.filter((f) => fieldToCol[f] === undefined);
  if (missing.length > 0) {
    const labels = missing.map((f) => `"${REQUIRED_FIELD_LABELS[f]}"`).join(', ');
    return {
      rows: [],
      error: `Colonne(s) manquante(s) : ${labels}. Le fichier doit contenir les colonnes "Nom complet", "Email" et "Association".`,
    };
  }

  const rows = [];
  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const raw = matrix[i];
    if (!Array.isArray(raw)) continue;

    const fullName = String(raw[fieldToCol.fullName] ?? '').trim();
    const email = String(raw[fieldToCol.email] ?? '').trim();
    const association = String(raw[fieldToCol.association] ?? '').trim();
    const phone =
      fieldToCol.phone !== undefined ? String(raw[fieldToCol.phone] ?? '').trim() : '';

    // Skip fully-empty rows.
    if (!fullName && !email && !association && !phone) continue;

    rows.push({ fullName, email, association, phone });
  }

  return { rows };
}

export default parseParticipantFile;
