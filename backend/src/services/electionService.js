'use strict';

const path = require('path');
const { pool, withTransaction } = require('../db/pool');
const electionsRepository = require('../db/repositories/electionsRepository');
const positionsRepository = require('../db/repositories/positionsRepository');
const candidatesRepository = require('../db/repositories/candidatesRepository');
const participantsRepository = require('../db/repositories/participantsRepository');
const usersRepository = require('../db/repositories/usersRepository');
const associationsRepository = require('../db/repositories/associationsRepository');
const membersRepository = require('../db/repositories/membersRepository');
const { isValidEmail } = require('./associationService');
const credentialService = require('./credentialService');
const emailService = require('./emailService');
const photoStorageService = require('./photoStorageService');

/**
 * Validate election input for name, start, and end presence and ordering.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 *
 * @param {{ name?: string, start?: string, end?: string }} input
 * @returns {{ valid: true } | { valid: false, errors: string[] }}
 */
function validateElectionInput(input) {
  const errors = [];

  // Check name presence
  if (!input.name || (typeof input.name === 'string' && input.name.trim() === '')) {
    errors.push('name is required');
  }

  // Check start presence and validity
  const startDate = input.start ? new Date(input.start) : null;
  if (!input.start || !startDate || isNaN(startDate.getTime())) {
    errors.push('start time is required');
  }

  // Check end presence and validity
  const endDate = input.end ? new Date(input.end) : null;
  if (!input.end || !endDate || isNaN(endDate.getTime())) {
    errors.push('end time is required');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Both dates are valid at this point — check ordering
  if (endDate.getTime() <= startDate.getTime()) {
    return { valid: false, errors: ['The end time must be later than the start time'] };
  }

  return { valid: true, startDate, endDate };
}

/**
 * Create a federation-scope election.
 * The election is created in Closed_State (no explicit state column — state is derived from schedule).
 * scope = 'FEDERATION', association_id = NULL.
 *
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {{ name?: string, start?: string, end?: string }} input
 * @param {{ pool?: import('pg').Pool }} [opts] - Optional pool override for testing.
 * @returns {Promise<{ success: boolean, election?: object, errors?: string[] }>}
 */
async function createFederationElection(identity, input, opts) {
  const validation = validateElectionInput(input);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const { startDate, endDate } = validation;

  const votersPerAssociation =
    input.votersPerAssociation == null ? null : input.votersPerAssociation;

  const election = await withTransaction(async (client) => {
    return electionsRepository.create(client, {
      name: input.name.trim(),
      scope: 'FEDERATION',
      association_id: null,
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      schedule_timezone: input.timezone || null,
      voters_per_association: votersPerAssociation,
      created_by: (identity && identity.id) || null,
    });
  }, opts);

  return {
    success: true,
    election: {
      id: election.id,
      name: election.name,
      scope: election.scope,
      association_id: election.association_id,
      start_at: election.start_at,
      end_at: election.end_at,
      schedule_timezone: election.schedule_timezone,
      voters_per_association: election.voters_per_association,
      created_by: election.created_by,
    },
  };
}

/**
 * Create an association-scope election.
 * The election is created in Closed_State (state derived from schedule).
 * scope = 'ASSOCIATION', association_id = identity.association_id.
 *
 * @param {{ id: string, role: string, association_id: string }} identity
 * @param {{ name?: string, start?: string, end?: string }} input
 * @param {{ pool?: import('pg').Pool }} [opts] - Optional pool override for testing.
 * @returns {Promise<{ success: boolean, election?: object, errors?: string[] }>}
 */
async function createAssociationElection(identity, input, opts) {
  const validation = validateElectionInput(input);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const { startDate, endDate } = validation;

  const election = await withTransaction(async (client) => {
    return electionsRepository.create(client, {
      name: input.name.trim(),
      scope: 'ASSOCIATION',
      association_id: identity.association_id,
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      schedule_timezone: input.timezone || null,
      created_by: (identity && identity.id) || null,
    });
  }, opts);

  return {
    success: true,
    election: {
      id: election.id,
      name: election.name,
      scope: election.scope,
      association_id: election.association_id,
      start_at: election.start_at,
      end_at: election.end_at,
      schedule_timezone: election.schedule_timezone,
      created_by: election.created_by,
    },
  };
}

/**
 * Add a participating association to a federation election.
 * Uses a single INSERT (no transaction needed). Rejects duplicates via
 * the composite primary key on federation_election_associations.
 *
 * @param {string} electionId - UUID of the federation election.
 * @param {string} associationId - UUID of the association to add.
 * @param {{ pool?: import('pg').Pool }} [opts] - Optional pool override for testing.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function addParticipatingAssociation(electionId, associationId, opts) {
  const p = (opts && opts.pool) || pool;
  try {
    await p.query(
      'INSERT INTO federation_election_associations (election_id, association_id) VALUES ($1, $2)',
      [electionId, associationId]
    );
    return { success: true };
  } catch (err) {
    if (err.code === '23505') {
      return {
        success: false,
        error: 'The association is already a participating scope of that federation election',
      };
    }
    throw err;
  }
}

/**
 * Add a DRAFT position to an election.
 *
 * A position is created with ONLY a name and starts as a DRAFT (published=false,
 * no voting window). Candidates can be added while a position is a DRAFT. The
 * voting window is set later via {@link publishPosition}. Positions may be added
 * only while the overall election has not yet ended (the management/preparation
 * window: now < election.end_at). A cap of 50 positions per election is enforced.
 *
 * @param {string} electionId - UUID of the election.
 * @param {{ name?: string }} input - Position details (only name is used).
 * @param {{ pool?: import('pg').Pool, electionsRepository?: object, positionsRepository?: object }} [deps] - Optional dependency injection for testing.
 * @returns {Promise<{ success: boolean, position?: { id: string, election_id: string, name: string, start_at: string|null, end_at: string|null, schedule_timezone: string|null, published: boolean }, error?: string }>}
 */
async function addPosition(electionId, input, deps) {
  const p = (deps && deps.pool) || pool;
  const electionsRepo = (deps && deps.electionsRepository) || electionsRepository;
  const positionsRepo = (deps && deps.positionsRepository) || positionsRepository;

  input = input || {};
  const { name } = input;

  // 1. Validate name is present and non-empty
  if (!name || (typeof name === 'string' && name.trim() === '')) {
    return { success: false, error: 'Position name is required' };
  }

  // 2. Look up the election by ID
  const election = await electionsRepo.findById(p, electionId);
  if (!election) {
    return { success: false, error: 'Election not found' };
  }

  // 3. Allow adding only while the election has not ended
  if (new Date() >= new Date(election.end_at)) {
    return { success: false, error: "L'élection est terminée; impossible d'ajouter un poste" };
  }

  // 4. Count existing positions for the election
  const count = await positionsRepo.countByElection(p, electionId);

  // 5. If count >= 50, reject
  if (count >= 50) {
    return { success: false, error: 'The maximum number of positions per election has been reached' };
  }

  // 6. INSERT the new DRAFT position (name only; window NULL, published FALSE)
  const position = await positionsRepo.create(p, {
    election_id: electionId,
    name: name.trim(),
  });

  // 7. Return success
  return {
    success: true,
    position: {
      id: position.id,
      election_id: position.election_id,
      name: position.name,
      start_at: position.start_at,
      end_at: position.end_at,
      schedule_timezone: position.schedule_timezone,
      published: position.published,
    },
  };
}

/**
 * Publish a DRAFT position by setting its voting window.
 *
 * Publishing locks the candidate list and makes the position votable during its
 * own window. The window must fall inside the election's management window and
 * the election must not have ended. A published position whose voting has already
 * started can no longer be modified.
 *
 * @param {string} positionId - UUID of the position to publish.
 * @param {{ start?: string, end?: string, timezone?: string }} input - The voting window.
 * @param {{ pool?: import('pg').Pool, electionsRepository?: object, positionsRepository?: object }} [deps] - Optional dependency injection for testing.
 * @returns {Promise<{ success: boolean, position?: object, error?: string }>}
 */
async function publishPosition(positionId, input, deps) {
  const p = (deps && deps.pool) || pool;
  const electionsRepo = (deps && deps.electionsRepository) || electionsRepository;
  const positionsRepo = (deps && deps.positionsRepository) || positionsRepository;
  const candidatesRepo = (deps && deps.candidatesRepository) || candidatesRepository;

  input = input || {};
  const { start, end, timezone } = input;

  // 1. Load the position
  const position = await positionsRepo.findById(p, positionId);
  if (!position) {
    return { success: false, error: 'Position not found' };
  }

  // 2. Load its election
  const election = await electionsRepo.findById(p, position.election_id);
  if (!election) {
    return { success: false, error: 'Election not found' };
  }

  // 3. Block once the election has ended
  if (new Date() >= new Date(election.end_at)) {
    return { success: false, error: "L'élection est terminée; impossible de publier ce poste" };
  }

  // 4. Lock once the position's voting has already started
  if (position.published === true && position.start_at && new Date() >= new Date(position.start_at)) {
    return { success: false, error: 'Le vote de ce poste a déjà commencé; modification impossible' };
  }

  // 4b. Ensure the position has at least 1 candidate
  const candidateCount = await candidatesRepo.countByPosition(p, positionId);
  if (candidateCount < 1) {
    return { success: false, error: 'Le poste doit avoir au moins un candidat pour être publié' };
  }

  // 5. Validate the voting window: start & end present, valid dates, end > start
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  const timingInvalid =
    !start ||
    !end ||
    !startDate ||
    !endDate ||
    isNaN(startDate.getTime()) ||
    isNaN(endDate.getTime()) ||
    endDate.getTime() <= startDate.getTime();
  if (timingInvalid) {
    return {
      success: false,
      error:
        "Veuillez fournir une date d'ouverture et de clôture valides (la clôture doit être après l'ouverture)",
    };
  }

  // 6. The window must fall inside the election's management window
  if (
    startDate.getTime() < new Date(election.start_at).getTime() ||
    endDate.getTime() > new Date(election.end_at).getTime()
  ) {
    return {
      success: false,
      error: "La fenêtre de vote du poste doit être comprise dans la période de l'élection",
    };
  }

  // 7. Persist the window and mark published
  const updated = await positionsRepo.publish(p, positionId, {
    start_at: startDate.toISOString(),
    end_at: endDate.toISOString(),
    schedule_timezone: timezone || null,
  });

  return {
    success: true,
    position: {
      id: updated.id,
      election_id: updated.election_id,
      name: updated.name,
      start_at: updated.start_at,
      end_at: updated.end_at,
      schedule_timezone: updated.schedule_timezone,
      published: updated.published,
    },
  };
}

/**
 * Maximum photo size in bytes (5 MB).
 */
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

/**
 * Allowed MIME types for candidate photos.
 */
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png'];

/**
 * Maximum number of candidates per position.
 */
const MAX_CANDIDATES_PER_POSITION = 100;

/**
 * Add a candidate to a position with validation and photo storage.
 *
 * @param {string} positionId - UUID of the position.
 * @param {{ name?: string, photo?: Buffer|string, motivation?: string, photoMimeType?: string, photoSize?: number }} input
 * @param {{ pool?: import('pg').Pool, photoStorageService?: object, candidatesRepository?: object, positionsRepository?: object, electionsRepository?: object }} [deps] - Injectable dependencies for testing.
 * @returns {Promise<{ success: boolean, candidate?: object, errors?: string[], error?: string }>}
 */
async function addCandidate(positionId, input, deps) {
  const p = (deps && deps.pool) || pool;
  const photoStorage = (deps && deps.photoStorageService) || photoStorageService;
  const candidatesRepo = (deps && deps.candidatesRepository) || candidatesRepository;
  const positionsRepo = (deps && deps.positionsRepository) || positionsRepository;
  const electionsRepo = (deps && deps.electionsRepository) || electionsRepository;

  const errors = [];

  // 1. Validate name: required, 1-100 chars
  if (!input.name || (typeof input.name === 'string' && input.name.trim() === '')) {
    errors.push('Candidate name is required');
  } else if (typeof input.name === 'string' && input.name.length > 100) {
    errors.push('Candidate name must not exceed 100 characters');
  }

  // 2. Validate motivation: required, 1-1000 chars
  if (!input.motivation || (typeof input.motivation === 'string' && input.motivation.trim() === '')) {
    errors.push('Candidate motivation is required');
  } else if (typeof input.motivation === 'string' && input.motivation.length > 1000) {
    errors.push('Candidate motivation must not exceed 1000 characters');
  }

  // 3. Validate photo: required
  if (!input.photo) {
    errors.push('Candidate photo is required');
  }

  // 4. Validate photoMimeType: must be JPEG or PNG
  if (input.photo && (!input.photoMimeType || !ALLOWED_PHOTO_TYPES.includes(input.photoMimeType))) {
    errors.push('Photo must be JPEG or PNG format');
  }

  // 5. Validate photoSize: must be ≤ 5 MB
  if (input.photo && input.photoSize && input.photoSize > MAX_PHOTO_SIZE) {
    errors.push('Photo must not exceed 5 MB');
  }

  // 6. If any validation errors, return them all
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // 7. Load the position and enforce the publish/ended locks
  const position = await positionsRepo.findById(p, positionId);
  if (!position) {
    return { success: false, error: 'Position not found' };
  }
  const election = await electionsRepo.findById(p, position.election_id);
  if (election && new Date() >= new Date(election.end_at)) {
    return { success: false, error: "L'élection est terminée; impossible d'ajouter un candidat" };
  }
  if (position.published === true) {
    return { success: false, error: 'Ce poste est publié; impossible d\'ajouter un candidat' };
  }

  // 8. Count existing candidates for the position
  const count = await candidatesRepo.countByPosition(p, positionId);

  // 9. If count >= 100, reject
  if (count >= MAX_CANDIDATES_PER_POSITION) {
    return { success: false, error: 'Maximum number of candidates per position has been reached' };
  }

  // 10. Store photo via Photo_Storage_Service
  const storageResult = await photoStorage.storeImage(input.photo, 'candidate_photo');

  // 11. If reference is null, reject
  if (!storageResult.reference) {
    return { success: false, error: 'Photo storage failed' };
  }

  // 12. INSERT candidate
  const candidate = await candidatesRepo.create(p, {
    position_id: positionId,
    name: input.name.trim(),
    photo_ref: storageResult.reference,
    motivation: input.motivation.trim(),
    created_by: input.createdBy || null,
  });

  // 13. Return success
  return {
    success: true,
    candidate: {
      id: candidate.id,
      position_id: candidate.position_id,
      name: candidate.name,
      photo_ref: candidate.photo_ref,
      motivation: candidate.motivation,
      created_by: candidate.created_by,
    },
  };
}

/**
 * Resolve email branding (logo + brand name) for an election's credential emails.
 * FEDERATION → federation logo (env) + 'FA2I'.
 * ASSOCIATION → the association's logo_ref + its name.
 *
 * @param {import('pg').PoolClient} client
 * @param {{ scope: string, association_id: string|null }} election
 * @param {object} assocRepo - associations repository.
 * @returns {Promise<{ logoUrl: string|null, brandName: string }>}
 */
async function resolveEmailBranding(client, election, assocRepo) {
  if (election.scope === 'ASSOCIATION') {
    const assoc = await assocRepo.findById(client, election.association_id);
    return {
      logoUrl: (assoc && assoc.logo_ref) || null,
      brandName: (assoc && assoc.name) || 'FA2I',
    };
  }
  // FEDERATION (default)
  if (process.env.FEDERATION_LOGO_URL) {
    return {
      logoUrl: process.env.FEDERATION_LOGO_URL,
      brandName: 'FA2I',
    };
  }
  // No public URL configured → embed the bundled federation logo inline.
  return {
    logoUrl: null,
    logoPath: path.join(__dirname, '..', 'assets', 'fa2i-logo.jpg'),
    brandName: 'FA2I',
  };
}

/**
 * Shared internal helper that adds a single participant to an election within a
 * transaction. Resolves/creates the voter account, sends a branded credential
 * email only for newly created users, and inserts the participant record.
 *
 * @param {{ id: string, scope: string, association_id: string|null }} election - Already-loaded election.
 * @param {{ email: string, fullName?: string, associationId?: string|null }} input
 * @param {object} identity - The calling manager's identity (unused for now, kept for parity).
 * @param {object} resolved - Resolved dependencies { usersRepo, participantsRepo, credSvc, emailSvc, assocRepo, txRunner, txOpts }.
 * @returns {Promise<{ success: boolean, participant?: { election_id: string, user_id: string }, created?: boolean, existingAccount?: boolean, error?: string }>}
 */
async function addParticipantInternal(election, input, identity, resolved) {
  const { usersRepo, participantsRepo, credSvc, emailSvc, assocRepo, txRunner, txOpts } = resolved;

  if (!input || !input.email || (typeof input.email === 'string' && input.email.trim() === '')) {
    return { success: false, error: 'Email is required' };
  }

  const emailLower = input.email.toLowerCase();

  // Determine the association the participant belongs to.
  let targetAssociationId;
  if (election.scope === 'ASSOCIATION') {
    targetAssociationId = election.association_id;
  } else if (
    election.scope === 'FEDERATION' &&
    identity &&
    (identity.role === 'ASSOCIATION_MANAGER' || identity.role === 'ASSOCIATION_ELECTION_MANAGER') &&
    identity.association_id
  ) {
    // Association-scoped callers may only add voters under THEIR OWN association,
    // regardless of any associationId supplied in the input.
    targetAssociationId = identity.association_id;
  } else {
    targetAssociationId = input.associationId || null;
  }

  try {
    const result = await txRunner(async (client) => {
      // Block duplicate emails within this election.
      const dup = await participantsRepo.findByEmailInElection(client, election.id, emailLower);
      if (dup) {
        return { success: false, error: 'Cet email est déjà inscrit pour cette élection' };
      }

      // Per-association quota: federation elections with a configured limit.
      const quota = election.voters_per_association;
      if (
        election.scope === 'FEDERATION' &&
        typeof quota === 'number' &&
        quota > 0 &&
        targetAssociationId
      ) {
        const count = await participantsRepo.countByElectionAndAssociation(
          client,
          election.id,
          targetAssociationId
        );
        if (count >= quota) {
          return { success: false, error: 'Quota de votants atteint pour cette association' };
        }
      }

      // 1. Find an existing user ANYWHERE in the system (by email, regardless
      //    of association or active state). If found, reuse it as-is.
      const existingUser = await usersRepo.findAnyByEmail(client, emailLower);

      let userId;
      let created = false;

      if (!existingUser) {
        // 2. Create a new VOTER account with a generated temp password.
        const tempPassword = credSvc.generateTemporaryPassword();
        const passwordHash = await credSvc.hashPassword(tempPassword);

        const newUser = await usersRepo.create(client, {
          email: input.email,
          emailLower,
          passwordHash,
          role: 'VOTER',
          associationId: targetAssociationId,
          fullName: input.fullName || null,
        });

        userId = newUser.id;
        created = true;

        // 3. Resolve branding by ELECTION scope and send credentials.
        const branding = await resolveEmailBranding(client, election, assocRepo);
        await emailSvc.sendCredentials(
          input.fullName || input.email,
          input.email,
          tempPassword,
          { ...branding }
        );
      } else {
        // Existing account: reuse without resetting password or emailing.
        userId = existingUser.id;
      }

      // 4. INSERT the participant record.
      const participant = await participantsRepo.create(client, {
        election_id: election.id,
        user_id: userId,
      });

      return {
        success: true,
        participant: {
          election_id: participant.election_id,
          user_id: participant.user_id,
        },
        created,
        existingAccount: !created,
      };
    }, txOpts);

    return result;
  } catch (err) {
    if (err.code === '23505') {
      return {
        success: false,
        error: 'The user is already a participant of this election',
      };
    }
    throw err;
  }
}

/**
 * Add a participant to an election.
 *
 * - Determines the target association from the election scope (ASSOCIATION uses
 *   the election's association; FEDERATION uses the optional input.associationId).
 * - Looks up an existing user (scoped to the association, or federation-wide).
 * - If none exists: creates a new VOTER, then sends a branded credential email
 *   (federation logo for federation elections, association logo for association
 *   elections). Existing users keep their password and receive no email.
 * - Inserts the participant record. Duplicate participants (23505) are reported.
 *
 * @param {{ id: string, scope: string, association_id: string|null }} election - The already-loaded election.
 * @param {{ email: string, fullName?: string, associationId?: string|null }} input
 * @param {{ id: string, role: string, association_id: string|null }} identity - The calling manager's identity.
 * @param {{ pool?: object, usersRepository?: object, participantsRepository?: object, credentialService?: object, emailService?: object, associationsRepository?: object, withTransaction?: Function }} [deps] - Injectable dependencies for testing.
 * @returns {Promise<{ success: boolean, participant?: { election_id: string, user_id: string }, created?: boolean, existingAccount?: boolean, error?: string }>}
 */
async function addParticipant(election, input, identity, deps) {
  const resolved = {
    usersRepo: (deps && deps.usersRepository) || usersRepository,
    participantsRepo: (deps && deps.participantsRepository) || participantsRepository,
    credSvc: (deps && deps.credentialService) || credentialService,
    emailSvc: (deps && deps.emailService) || emailService,
    assocRepo: (deps && deps.associationsRepository) || associationsRepository,
    txRunner: (deps && deps.withTransaction) || withTransaction,
    txOpts: deps && deps.pool ? { pool: deps.pool } : undefined,
  };

  return addParticipantInternal(election, input, identity, resolved);
}

/**
 * Validate a set of participant rows for an election WITHOUT writing anything.
 *
 * Performs a server-side preview useful before a bulk import. For each row it
 * checks: full name present, email present and well-formed, (for federation
 * elections) the association exists, no duplicate email within the submitted
 * rows, the email is not already a participant, and the per-association quota
 * (simulated cumulatively from the current DB count) is not exceeded.
 *
 * Read-only: uses the pool directly (no transaction).
 *
 * @param {{ id: string, scope: string, association_id: string|null, voters_per_association?: number|null }} election
 * @param {Array<{ fullName?: string, email?: string, associationId?: string|null }>} rows
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {{ pool?: object, participantsRepository?: object, associationsRepository?: object }} [deps]
 * @returns {Promise<{ success: boolean, rows: Array<{ fullName: string|null, email: string|null, associationId: string|null, valid: boolean, error: string|null, existing: boolean }>, summary: { valid: number, invalid: number } }>}
 */
async function validateParticipants(election, rows, identity, deps) {
  const p = (deps && deps.pool) || pool;
  const participantsRepo = (deps && deps.participantsRepository) || participantsRepository;
  const assocRepo = (deps && deps.associationsRepository) || associationsRepository;
  const usersRepo = (deps && deps.usersRepository) || usersRepository;

  const list = Array.isArray(rows) ? rows : [];
  const quota = election.voters_per_association;
  const quotaEnabled = election.scope === 'FEDERATION' && typeof quota === 'number' && quota > 0;

  // Association-scoped callers may only preview voters under their own association.
  const forcedAssociationId =
    election.scope === 'FEDERATION' &&
    identity &&
    (identity.role === 'ASSOCIATION_MANAGER' || identity.role === 'ASSOCIATION_ELECTION_MANAGER') &&
    identity.association_id
      ? identity.association_id
      : null;

  // Track emails seen within this submission (to detect in-file duplicates).
  const seenEmails = new Set();
  // Track a running count per association, seeded lazily from the DB count.
  const assocCounts = new Map();
  // Cache association existence lookups.
  const assocExists = new Map();
  // Cache global existing-account lookups by emailLower.
  const existingAccounts = new Map();

  const resultRows = [];

  for (const row of list) {
    const fullName = (row && row.fullName) || null;
    const rawEmail = (row && typeof row.email === 'string') ? row.email : null;
    let associationId;
    if (election.scope === 'ASSOCIATION') {
      associationId = election.association_id;
    } else if (forcedAssociationId) {
      associationId = forcedAssociationId;
    } else {
      associationId = (row && row.associationId) || null;
    }

    let error = null;

    // 1. Full name present.
    if (!fullName || (typeof fullName === 'string' && fullName.trim() === '')) {
      error = 'Le nom complet est requis';
    }

    // 2. Email present and valid format.
    const emailLower = rawEmail ? rawEmail.toLowerCase() : null;
    if (!error) {
      if (!rawEmail || rawEmail.trim() === '') {
        error = "L'email est requis";
      } else if (!isValidEmail(rawEmail)) {
        error = "L'email est invalide";
      }
    }

    // 3. Federation elections require a known association.
    if (!error && election.scope === 'FEDERATION') {
      if (!associationId) {
        error = 'Association inconnue';
      } else {
        let exists = assocExists.get(associationId);
        if (exists === undefined) {
          const assoc = await assocRepo.findById(p, associationId);
          exists = !!assoc;
          assocExists.set(associationId, exists);
        }
        if (!exists) {
          error = 'Association inconnue';
        }
      }
    }

    // 4. Duplicate within the submitted rows.
    if (!error && emailLower) {
      if (seenEmails.has(emailLower)) {
        error = 'Doublon dans le fichier';
      }
    }

    // 5. Already a participant in the election.
    if (!error && emailLower) {
      const existing = await participantsRepo.findByEmailInElection(p, election.id, emailLower);
      if (existing) {
        error = 'Cet email est déjà inscrit pour cette élection';
      }
    }

    // 6. Quota (cumulative) for federation elections.
    if (!error && quotaEnabled && associationId) {
      let current = assocCounts.get(associationId);
      if (current === undefined) {
        current = await participantsRepo.countByElectionAndAssociation(p, election.id, associationId);
        assocCounts.set(associationId, current);
      }
      if (current >= quota) {
        error = 'Quota dépassé pour cette association';
      } else {
        assocCounts.set(associationId, current + 1);
      }
    }

    // Record the email as seen only when otherwise acceptable, so a later
    // identical email is flagged as an in-file duplicate.
    if (!error && emailLower) {
      seenEmails.add(emailLower);
    }

    // Determine whether an account already exists ANYWHERE for this email
    // (regardless of association/active state). An existing account is still a
    // VALID row to add — it will be reused — but the preview labels it so the
    // UI can distinguish "compte existant" from "nouveau". Cached per email.
    let existing = false;
    if (emailLower) {
      if (existingAccounts.has(emailLower)) {
        existing = existingAccounts.get(emailLower);
      } else {
        const found = await usersRepo.findAnyByEmail(p, emailLower);
        existing = !!found;
        existingAccounts.set(emailLower, existing);
      }
    }

    resultRows.push({
      fullName,
      email: rawEmail,
      associationId,
      valid: error === null,
      error,
      existing,
    });
  }

  const valid = resultRows.filter((r) => r.valid).length;
  return {
    success: true,
    rows: resultRows,
    summary: { valid, invalid: resultRows.length - valid },
  };
}

/**
 * Add multiple participants to an election, processing each row sequentially.
 *
 * Each row runs the same logic as {@link addParticipant} in its own transaction.
 * Produces a summary distinguishing newly created (and emailed) accounts from
 * reused existing accounts, plus duplicates (already a participant / in-file)
 * and failed rows (validation/other errors).
 *
 * @param {{ id: string, scope: string, association_id: string|null }} election - The already-loaded election.
 * @param {Array<{ fullName?: string, email: string, associationId?: string|null }>} rows
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {object} [deps] - Injectable dependencies for testing (same shape as addParticipant deps).
 * @returns {Promise<{ success: boolean, summary: { added: number, reused: number, duplicates: number, failed: Array<{ email: string, error: string }> } }>}
 */
async function bulkAddParticipants(election, rows, identity, deps) {
  const resolved = {
    usersRepo: (deps && deps.usersRepository) || usersRepository,
    participantsRepo: (deps && deps.participantsRepository) || participantsRepository,
    credSvc: (deps && deps.credentialService) || credentialService,
    emailSvc: (deps && deps.emailService) || emailService,
    assocRepo: (deps && deps.associationsRepository) || associationsRepository,
    txRunner: (deps && deps.withTransaction) || withTransaction,
    txOpts: deps && deps.pool ? { pool: deps.pool } : undefined,
  };

  const summary = { added: 0, reused: 0, duplicates: 0, failed: [] };
  const list = Array.isArray(rows) ? rows : [];
  // Track emails already processed in this run to flag in-file duplicates.
  const seenEmails = new Set();

  for (const row of list) {
    const email = (row && row.email) || '';
    const emailLower = typeof email === 'string' ? email.toLowerCase() : '';

    // In-file duplicate: same email appears earlier in this submission.
    if (emailLower && seenEmails.has(emailLower)) {
      summary.duplicates += 1;
      continue;
    }

    try {
      const result = await addParticipantInternal(election, row, identity, resolved);
      if (result.success) {
        // Classify by whether a brand-new account was created (and emailed)
        // versus an existing account that was reused.
        if (result.created) {
          summary.added += 1;
        } else {
          summary.reused += 1;
        }
        if (emailLower) seenEmails.add(emailLower);
      } else if (
        result.error === 'The user is already a participant of this election' ||
        result.error === 'Cet email est déjà inscrit pour cette élection'
      ) {
        summary.duplicates += 1;
        if (emailLower) seenEmails.add(emailLower);
      } else {
        summary.failed.push({ email, error: result.error });
      }
    } catch (err) {
      summary.failed.push({ email, error: err.message });
    }
  }

  return { success: true, summary };
}

/**
 * Add an association's members as participants of one of its own elections.
 *
 * Members-only and association-scope only: federation elections are rejected.
 * Targets are resolved from the association's member roster — either ALL
 * members (all === true) or the provided userIds intersected with the roster
 * (non-members are ignored silently). Each target is inserted as a participant
 * unless they already are one (counted as a duplicate). No emails are sent:
 * members already have accounts.
 *
 * @param {{ id: string, scope: string, association_id: string|null }} election - The already-loaded election.
 * @param {{ userIds?: string[], all?: boolean }} input
 * @param {{ id: string, role: string, association_id: string|null }} identity
 * @param {{ pool?: object, participantsRepository?: object, membersRepository?: object, withTransaction?: Function }} [deps]
 * @returns {Promise<{ success: boolean, summary?: { added: number, duplicates: number }, error?: string }>}
 */
async function addMembersAsParticipants(election, input, identity, deps) {
  if (!election || election.scope !== 'ASSOCIATION') {
    return { success: false, error: "Réservé aux élections d'association" };
  }

  const participantsRepo = (deps && deps.participantsRepository) || participantsRepository;
  const membersRepo = (deps && deps.membersRepository) || membersRepository;
  const txRunner = (deps && deps.withTransaction) || withTransaction;
  const txOpts = deps && deps.pool ? { pool: deps.pool } : undefined;

  input = input || {};

  const summary = { added: 0, duplicates: 0 };

  await txRunner(async (client) => {
    // Resolve the association's ACTIVE member user ids. Disabled members are
    // excluded so they cannot be added to an election.
    const memberIds = await membersRepo.listActiveUserIds(client, election.association_id);
    const memberSet = new Set(memberIds);

    // Determine the target set: all active members, or the requested ids
    // restricted to actual active members of this association.
    let targetIds;
    if (input.all === true) {
      targetIds = memberIds;
    } else {
      const requested = Array.isArray(input.userIds) ? input.userIds : [];
      targetIds = requested.filter((id) => memberSet.has(id));
    }

    for (const userId of targetIds) {
      // Pre-check to count duplicates cleanly.
      const existing = await participantsRepo.findByElectionAndUser(client, election.id, userId);
      if (existing) {
        summary.duplicates += 1;
        continue;
      }
      try {
        await participantsRepo.create(client, { election_id: election.id, user_id: userId });
        summary.added += 1;
      } catch (err) {
        if (err.code === '23505') {
          summary.duplicates += 1;
        } else {
          throw err;
        }
      }
    }
  }, txOpts);

  return { success: true, summary };
}

/**
 * Add the CALLER'S association members as voters of a FEDERATION-scope election.
 *
 * Mirrors addMembersAsParticipants but for federation elections, where an
 * association manager declares which of THEIR OWN members may vote. Members are
 * resolved from identity.association_id (not the election, which has none), and
 * the per-association quota (voters_per_association) is enforced: once the
 * association's quota is reached, remaining selections are skipped and reported.
 *
 * @param {object} election - { id, scope, voters_per_association }
 * @param {{ userIds?: string[], all?: boolean }} input
 * @param {{ id: string, association_id: string|null }} identity
 * @param {object} [deps]
 * @returns {Promise<{ success: boolean, summary?: { added: number, duplicates: number, skippedQuota: number }, error?: string }>}
 */
async function addAssociationMembersToFederationElection(election, input, identity, deps) {
  if (!election || election.scope !== 'FEDERATION') {
    return { success: false, error: 'Réservé aux élections de la fédération' };
  }
  if (!identity || !identity.association_id) {
    return { success: false, error: 'Aucune association associée à votre compte' };
  }

  const associationId = identity.association_id;
  const participantsRepo = (deps && deps.participantsRepository) || participantsRepository;
  const membersRepo = (deps && deps.membersRepository) || membersRepository;
  const txRunner = (deps && deps.withTransaction) || withTransaction;
  const txOpts = deps && deps.pool ? { pool: deps.pool } : undefined;

  input = input || {};

  const quota =
    typeof election.voters_per_association === 'number' && election.voters_per_association > 0
      ? election.voters_per_association
      : null;

  const summary = { added: 0, duplicates: 0, skippedQuota: 0 };

  await txRunner(async (client) => {
    // Only ACTIVE members of the caller's association are eligible.
    const memberIds = await membersRepo.listActiveUserIds(client, associationId);
    const memberSet = new Set(memberIds);

    let targetIds;
    if (input.all === true) {
      targetIds = memberIds;
    } else {
      const requested = Array.isArray(input.userIds) ? input.userIds : [];
      targetIds = requested.filter((id) => memberSet.has(id));
    }

    // Seed the running quota count from the DB (participants of this election
    // belonging to this association).
    let currentCount =
      quota != null
        ? await participantsRepo.countByElectionAndAssociation(client, election.id, associationId)
        : 0;

    for (const userId of targetIds) {
      const existing = await participantsRepo.findByElectionAndUser(client, election.id, userId);
      if (existing) {
        summary.duplicates += 1;
        continue;
      }
      if (quota != null && currentCount >= quota) {
        summary.skippedQuota += 1;
        continue;
      }
      try {
        await participantsRepo.create(client, { election_id: election.id, user_id: userId });
        summary.added += 1;
        currentCount += 1;
      } catch (err) {
        if (err.code === '23505') {
          summary.duplicates += 1;
        } else {
          throw err;
        }
      }
    }
  }, txOpts);

  return { success: true, summary };
}

/**
 * Update mutable fields of an election (name and/or schedule). Only the creator
 * is authorized to call this — authorization is enforced in the route layer.
 *
 * The election must not have ended. Timing changes are validated for ordering
 * (end strictly after start), merging any omitted field with the stored value.
 *
 * @param {string} electionId - UUID of the election.
 * @param {{ name?: string, start?: string, end?: string, timezone?: string, votersPerAssociation?: number|null }} input
 * @param {{ pool?: import('pg').Pool, electionsRepository?: object, withTransaction?: Function }} [deps]
 * @returns {Promise<{ success: boolean, election?: object, errors?: string[], error?: string }>}
 */
async function updateElection(electionId, input, deps) {
  const p = (deps && deps.pool) || pool;
  const electionsRepo = (deps && deps.electionsRepository) || electionsRepository;

  input = input || {};

  const election = await electionsRepo.findById(p, electionId);
  if (!election) {
    return { success: false, error: 'Election not found' };
  }
  if (new Date() >= new Date(election.end_at)) {
    return { success: false, error: "L'élection est terminée; modification impossible" };
  }

  const fields = {};
  const errors = [];

  if (input.name !== undefined) {
    if (!input.name || (typeof input.name === 'string' && input.name.trim() === '')) {
      errors.push('name is required');
    } else {
      fields.name = input.name.trim();
    }
  }

  // Resolve effective start/end for ordering validation when either changes.
  const timingChanged = input.start !== undefined || input.end !== undefined;
  if (timingChanged) {
    const startSource = input.start !== undefined ? input.start : election.start_at;
    const endSource = input.end !== undefined ? input.end : election.end_at;
    const startDate = startSource ? new Date(startSource) : null;
    const endDate = endSource ? new Date(endSource) : null;

    if (!startDate || isNaN(startDate.getTime())) {
      errors.push('start time is required');
    }
    if (!endDate || isNaN(endDate.getTime())) {
      errors.push('end time is required');
    }
    if (
      startDate &&
      endDate &&
      !isNaN(startDate.getTime()) &&
      !isNaN(endDate.getTime()) &&
      endDate.getTime() <= startDate.getTime()
    ) {
      errors.push('The end time must be later than the start time');
    }

    if (errors.length === 0) {
      if (input.start !== undefined) fields.start_at = startDate.toISOString();
      if (input.end !== undefined) fields.end_at = endDate.toISOString();
    }
  }

  if (input.timezone !== undefined) {
    fields.schedule_timezone = input.timezone || null;
  }
  if (input.votersPerAssociation !== undefined && election.scope === 'FEDERATION') {
    fields.voters_per_association =
      input.votersPerAssociation == null ? null : input.votersPerAssociation;
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const updated = await electionsRepo.update(p, electionId, fields);
  return {
    success: true,
    election: {
      id: updated.id,
      name: updated.name,
      scope: updated.scope,
      association_id: updated.association_id,
      start_at: updated.start_at,
      end_at: updated.end_at,
      schedule_timezone: updated.schedule_timezone,
      voters_per_association: updated.voters_per_association,
      created_by: updated.created_by,
    },
  };
}

/**
 * Delete an election. Only the creator is authorized (enforced in the route).
 * Related positions, candidates, participants and votes cascade-delete.
 *
 * @param {string} electionId - UUID of the election.
 * @param {{ pool?: import('pg').Pool, electionsRepository?: object }} [deps]
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function deleteElection(electionId, deps) {
  const p = (deps && deps.pool) || pool;
  const electionsRepo = (deps && deps.electionsRepository) || electionsRepository;

  const removed = await electionsRepo.remove(p, electionId);
  if (!removed) {
    return { success: false, error: 'Election not found' };
  }
  return { success: true };
}

/**
 * Update a candidate (name, motivation, and/or photo). Only the creator is
 * authorized (enforced in the route). Modification is blocked once the
 * candidate's position has been published (candidate list locked).
 *
 * @param {string} candidateId - UUID of the candidate.
 * @param {{ name?: string, motivation?: string, photo?: Buffer|string, photoMimeType?: string, photoSize?: number }} input
 * @param {{ pool?: import('pg').Pool, photoStorageService?: object, candidatesRepository?: object, positionsRepository?: object }} [deps]
 * @returns {Promise<{ success: boolean, candidate?: object, errors?: string[], error?: string }>}
 */
async function updateCandidate(candidateId, input, deps) {
  const p = (deps && deps.pool) || pool;
  const photoStorage = (deps && deps.photoStorageService) || photoStorageService;
  const candidatesRepo = (deps && deps.candidatesRepository) || candidatesRepository;
  const positionsRepo = (deps && deps.positionsRepository) || positionsRepository;

  input = input || {};

  const candidate = await candidatesRepo.findById(p, candidateId);
  if (!candidate) {
    return { success: false, error: 'Candidate not found' };
  }

  const position = await positionsRepo.findById(p, candidate.position_id);
  if (position && position.published === true) {
    return { success: false, error: 'Ce poste est publié; modification du candidat impossible' };
  }

  const errors = [];
  const fields = {};

  if (input.name !== undefined) {
    if (!input.name || (typeof input.name === 'string' && input.name.trim() === '')) {
      errors.push('Candidate name is required');
    } else if (typeof input.name === 'string' && input.name.length > 100) {
      errors.push('Candidate name must not exceed 100 characters');
    } else {
      fields.name = input.name.trim();
    }
  }

  if (input.motivation !== undefined) {
    if (!input.motivation || (typeof input.motivation === 'string' && input.motivation.trim() === '')) {
      errors.push('Candidate motivation is required');
    } else if (typeof input.motivation === 'string' && input.motivation.length > 1000) {
      errors.push('Candidate motivation must not exceed 1000 characters');
    } else {
      fields.motivation = input.motivation.trim();
    }
  }

  if (input.photo) {
    if (!input.photoMimeType || !ALLOWED_PHOTO_TYPES.includes(input.photoMimeType)) {
      errors.push('Photo must be JPEG or PNG format');
    }
    if (input.photoSize && input.photoSize > MAX_PHOTO_SIZE) {
      errors.push('Photo must not exceed 5 MB');
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  if (input.photo) {
    const storageResult = await photoStorage.storeImage(input.photo, 'candidate_photo');
    if (!storageResult.reference) {
      return { success: false, error: 'Photo storage failed' };
    }
    fields.photo_ref = storageResult.reference;
  }

  const updated = await candidatesRepo.update(p, candidateId, fields);
  return {
    success: true,
    candidate: {
      id: updated.id,
      position_id: updated.position_id,
      name: updated.name,
      photo_ref: updated.photo_ref,
      motivation: updated.motivation,
      created_by: updated.created_by,
    },
  };
}

/**
 * Delete a candidate. Only the creator is authorized (enforced in the route).
 * Deletion is blocked once the candidate's position has been published.
 *
 * @param {string} candidateId - UUID of the candidate.
 * @param {{ pool?: import('pg').Pool, candidatesRepository?: object, positionsRepository?: object }} [deps]
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function deleteCandidate(candidateId, deps) {
  const p = (deps && deps.pool) || pool;
  const candidatesRepo = (deps && deps.candidatesRepository) || candidatesRepository;
  const positionsRepo = (deps && deps.positionsRepository) || positionsRepository;

  const candidate = await candidatesRepo.findById(p, candidateId);
  if (!candidate) {
    return { success: false, error: 'Candidate not found' };
  }

  const position = await positionsRepo.findById(p, candidate.position_id);
  if (position && position.published === true) {
    return { success: false, error: 'Ce poste est publié; suppression du candidat impossible' };
  }

  await candidatesRepo.remove(p, candidateId);
  return { success: true };
}

/**
 * Remove a voter (participant) from an election. Role-based authorization is
 * enforced in the route (canManageVoters). The participant link is removed; the
 * underlying user account is preserved. A voter who has already cast a ballot
 * cannot be removed (their recorded vote must be preserved).
 *
 * @param {string} electionId - UUID of the election.
 * @param {string} userId - UUID of the participant user to remove.
 * @param {{ pool?: import('pg').Pool, participantsRepository?: object }} [deps]
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function removeParticipant(electionId, userId, deps) {
  const p = (deps && deps.pool) || pool;
  const participantsRepo = (deps && deps.participantsRepository) || participantsRepository;

  // Guard: a voter who has already voted cannot be removed.
  const voted = await p.query(
    'SELECT 1 FROM voter_voted WHERE election_id = $1 AND user_id = $2 LIMIT 1',
    [electionId, userId]
  );
  if (voted.rows.length > 0) {
    return { success: false, error: 'Ce votant a déjà voté; suppression impossible' };
  }

  const removed = await participantsRepo.remove(p, electionId, userId);
  if (!removed) {
    return { success: false, error: 'Participant introuvable' };
  }
  return { success: true };
}

module.exports = {
  createFederationElection,
  createAssociationElection,
  validateElectionInput,
  addParticipatingAssociation,
  addPosition,
  publishPosition,
  addCandidate,
  updateElection,
  deleteElection,
  updateCandidate,
  deleteCandidate,
  removeParticipant,
  addParticipant,
  validateParticipants,
  bulkAddParticipants,
  addMembersAsParticipants,
  addAssociationMembersToFederationElection,
};
