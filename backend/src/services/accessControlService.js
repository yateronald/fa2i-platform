'use strict';

/**
 * Access_Control_Service
 *
 * Authorizes actions based on a user's role and organizational scope.
 * Identity shape: { id, role, association_id }
 * Election shape: { id, scope, association_id }
 *
 * Roles: FEDERATION_ADMINISTRATOR, ASSOCIATION_MANAGER, VOTER, FEDERATION_ELECTION_MANAGER
 */

const ROLES = {
  FEDERATION_ADMINISTRATOR: 'FEDERATION_ADMINISTRATOR',
  ASSOCIATION_MANAGER: 'ASSOCIATION_MANAGER',
  VOTER: 'VOTER',
  FEDERATION_ELECTION_MANAGER: 'FEDERATION_ELECTION_MANAGER',
  ASSOCIATION_ELECTION_MANAGER: 'ASSOCIATION_ELECTION_MANAGER',
};

const SCOPES = {
  FEDERATION: 'FEDERATION',
  ASSOCIATION: 'ASSOCIATION',
};

/**
 * True iff the identity may manage federation elections.
 * Both FEDERATION_ADMINISTRATOR and FEDERATION_ELECTION_MANAGER are permitted.
 * Satisfies Req 1.3: permits creation/modification/deletion of federation elections.
 *
 * @param {object} identity - { id, role, association_id }
 * @returns {boolean}
 */
function canManageFederationElection(identity) {
  return identity.role === ROLES.FEDERATION_ADMINISTRATOR || identity.role === ROLES.FEDERATION_ELECTION_MANAGER;
}

/**
 * True iff the identity holds the FEDERATION_ADMINISTRATOR role.
 * Satisfies Req 1.4: permits creation/modification/deletion of association records.
 *
 * @param {object} identity - { id, role, association_id }
 * @returns {boolean}
 */
function canManageAssociation(identity) {
  return identity.role === ROLES.FEDERATION_ADMINISTRATOR;
}

/**
 * True iff the identity holds the FEDERATION_ADMINISTRATOR role.
 * Only the full federation administrator may manage federation users.
 *
 * @param {object} identity - { id, role, association_id }
 * @returns {boolean}
 */
function canManageUsers(identity) {
  return identity.role === ROLES.FEDERATION_ADMINISTRATOR;
}

/**
 * True iff the identity is an ASSOCIATION_MANAGER assigned to the election's association.
 * ALWAYS false for FEDERATION_ADMINISTRATOR (Req 1.5, 19.2).
 * Satisfies Req 8.3: association managers manage only their own association's elections.
 *
 * @param {object} identity - { id, role, association_id }
 * @param {object} election - { id, scope, association_id }
 * @returns {boolean}
 */
function canManageAssociationElection(identity, election) {
  if (identity.role === ROLES.FEDERATION_ADMINISTRATOR) {
    return false;
  }
  return (
    (identity.role === ROLES.ASSOCIATION_MANAGER ||
      identity.role === ROLES.ASSOCIATION_ELECTION_MANAGER) &&
    identity.association_id != null &&
    election.association_id != null &&
    identity.association_id === election.association_id
  );
}

/**
 * True iff the identity may create association-scope elections for their own
 * association. Both ASSOCIATION_MANAGER and ASSOCIATION_ELECTION_MANAGER qualify
 * provided they have an association_id.
 *
 * @param {object} identity - { id, role, association_id }
 * @returns {boolean}
 */
function canCreateAssociationElection(identity) {
  return (
    identity.association_id != null &&
    (identity.role === ROLES.ASSOCIATION_MANAGER ||
      identity.role === ROLES.ASSOCIATION_ELECTION_MANAGER)
  );
}

/**
 * True iff the identity may use the association sub-user management endpoints.
 * This is the route-level capability gate; per-association authorization
 * (which association a caller may act on) is enforced inside
 * Association_User_Service.
 *
 * Authorized callers:
 * - FEDERATION_ADMINISTRATOR — may manage sub-users for ANY association.
 * - ASSOCIATION_MANAGER with an association_id — the full-control president,
 *   locked to their OWN association.
 *
 * Other roles (ASSOCIATION_ELECTION_MANAGER, VOTER, association_id-less
 * managers, federation election managers) are NOT association-user managers.
 *
 * @param {object} identity - { id, role, association_id }
 * @returns {boolean}
 */
function canManageAssociationUsers(identity) {
  if (identity.role === ROLES.FEDERATION_ADMINISTRATOR) {
    return true;
  }
  return identity.role === ROLES.ASSOCIATION_MANAGER && identity.association_id != null;
}

/**
 * True iff the identity may manage the members (roster) of their association.
 *
 * Membership management is an ASSOCIATION-ONLY capability — federation roles
 * are never member managers. Authorized callers:
 * - ASSOCIATION_MANAGER with an association_id (the full-control president).
 * - ASSOCIATION_ELECTION_MANAGER with an association_id AND the
 *   can_manage_members flag set.
 *
 * Per-association authorization is implicit: a caller may only ever act on
 * their OWN association (identity.association_id).
 *
 * @param {object} identity - { id, role, association_id, can_manage_members }
 * @returns {boolean}
 */
function canManageMembers(identity) {
  if (!identity) {
    return false;
  }
  if (identity.role === ROLES.ASSOCIATION_MANAGER && identity.association_id != null) {
    return true;
  }
  if (
    identity.role === ROLES.ASSOCIATION_ELECTION_MANAGER &&
    identity.association_id != null &&
    identity.can_manage_members === true
  ) {
    return true;
  }
  return false;
}

/**
 * True iff the identity may add voters to the given FEDERATION election.
 *
 * Only meaningful for federation-scope elections. Authorized:
 * - Federation roles (FEDERATION_ADMINISTRATOR or FEDERATION_ELECTION_MANAGER).
 * - ASSOCIATION_MANAGER with an association_id (full-control president).
 * - ASSOCIATION_ELECTION_MANAGER with an association_id AND the
 *   can_add_federation_voters flag set.
 *
 * @param {object} identity - { id, role, association_id, can_add_federation_voters }
 * @param {object} election - { id, scope, association_id }
 * @returns {boolean}
 */
function canAddFederationVoters(identity, election) {
  if (!election || election.scope !== SCOPES.FEDERATION) {
    return false;
  }
  if (
    identity.role === ROLES.FEDERATION_ADMINISTRATOR ||
    identity.role === ROLES.FEDERATION_ELECTION_MANAGER
  ) {
    return true;
  }
  if (identity.role === ROLES.ASSOCIATION_MANAGER && identity.association_id != null) {
    return true;
  }
  if (
    identity.role === ROLES.ASSOCIATION_ELECTION_MANAGER &&
    identity.association_id != null &&
    identity.can_add_federation_voters === true
  ) {
    return true;
  }
  return false;
}

/**
 * True iff the identity may MANAGE the given election (add positions/candidates/
 * participants, etc.), based on the election's scope.
 * - FEDERATION election: federation admin OR federation election manager.
 * - ASSOCIATION election: the ASSOCIATION_MANAGER assigned to that association.
 *
 * @param {object} identity - { id, role, association_id }
 * @param {object} election - { id, scope, association_id }
 * @returns {boolean}
 */
function canManageElection(identity, election) {
  if (!election) return false;
  if (election.scope === SCOPES.FEDERATION) {
    return canManageFederationElection(identity);
  }
  if (election.scope === SCOPES.ASSOCIATION) {
    return canManageAssociationElection(identity, election);
  }
  return false;
}

/**
 * True when the identity is authorized to view election results.
 *
 * Authorized viewers:
 * - The election's manager (matching role + scope):
 *   - FEDERATION_ADMINISTRATOR for federation elections
 *   - ASSOCIATION_MANAGER of the election's association for association elections
 * - FEDERATION_ADMINISTRATOR for ANY election (including association elections in any state) (Req 19.1)
 * - Participants after the election is closed (Req 18.1, 18.2)
 *
 * @param {object} identity - { id, role, association_id }
 * @param {object} election - { id, scope, association_id }
 * @param {object} context - { isParticipant: boolean, isClosed: boolean }
 * @returns {boolean}
 */
function canViewElectionResults(identity, election, { isParticipant, isClosed }) {
  // Federation admins can always view any election's results (Req 19.1)
  if (identity.role === ROLES.FEDERATION_ADMINISTRATOR) {
    return true;
  }

  // Federation election managers can view federation election results
  if (identity.role === ROLES.FEDERATION_ELECTION_MANAGER && election.scope === SCOPES.FEDERATION) {
    return true;
  }

  // Association manager can view results for elections in their own association
  if (
    (identity.role === ROLES.ASSOCIATION_MANAGER ||
      identity.role === ROLES.ASSOCIATION_ELECTION_MANAGER) &&
    election.scope === SCOPES.ASSOCIATION &&
    identity.association_id === election.association_id
  ) {
    return true;
  }

  // Participants can view results only after the election is closed (Req 18.1, 18.2)
  if (isParticipant && isClosed) {
    return true;
  }

  return false;
}

/**
 * True iff the identity is eligible to cast a ballot in the election.
 *
 * Requirements:
 * - Must be a participant (Req 13.2, 13.3)
 * - For association elections: identity must belong to the election's association (Req 13.2)
 * - For federation elections: participation alone is sufficient (Req 13.3)
 *
 * @param {object} identity - { id, role, association_id }
 * @param {object} election - { id, scope, association_id }
 * @param {object} context - { isParticipant: boolean }
 * @returns {boolean}
 */
function canCastBallot(identity, election, { isParticipant }) {
  if (!isParticipant) {
    return false;
  }

  // For association elections, verify scope membership
  if (election.scope === SCOPES.ASSOCIATION) {
    return identity.association_id === election.association_id;
  }

  // For federation elections, participation alone is sufficient
  return true;
}

/**
 * True iff the identity may view the per-position result for a single position.
 *
 * Authorized viewers:
 * - The election's manager (always, regardless of position state).
 * - Participants ONLY when the position is CLOSED (Req 18.1, 18.2 applied per position).
 *
 * All other callers are denied. Counts must not be disclosed on denial.
 *
 * @param {object} identity - { id, role, association_id }
 * @param {object} election - { id, scope, association_id }
 * @param {object} context - { isParticipant: boolean, positionState: 'DRAFT'|'PENDING'|'OPEN'|'CLOSED' }
 * @returns {boolean}
 */
function canViewPositionResult(identity, election, { isParticipant, positionState }) {
  if (canManageElection(identity, election)) {
    return true;
  }
  if (isParticipant && positionState === 'CLOSED') {
    return true;
  }
  return false;
}

/**
 * True iff the identity may MODIFY or DELETE the given election.
 *
 * Ownership rule (Req: creator-only modify/delete): ONLY the user who created
 * the election may modify or delete it — not even other users with the same
 * role. Applies to both federation and association elections.
 *
 * Legacy fallback: elections created before ownership tracking have
 * created_by = NULL. For those rows we fall back to role/scope-based
 * management authorization so they are not orphaned.
 *
 * @param {object} identity - { id, role, association_id }
 * @param {object} election - { id, scope, association_id, created_by }
 * @returns {boolean}
 */
function canModifyElection(identity, election) {
  if (!identity || !election) return false;
  if (election.created_by != null) {
    return identity.id === election.created_by;
  }
  // Legacy rows: no recorded creator → fall back to role/scope management rules.
  return canManageElection(identity, election);
}

/**
 * True iff the identity may MODIFY or DELETE the given candidate.
 *
 * Ownership rule (Req: creator-only modify/delete): ONLY the user who created
 * the candidate may modify or delete it — not even other managers of the same
 * election.
 *
 * Legacy fallback: candidates created before ownership tracking have
 * created_by = NULL. For those rows we fall back to election-management
 * authorization (the manager of the candidate's election).
 *
 * @param {object} identity - { id, role, association_id }
 * @param {object} candidate - { id, position_id, created_by }
 * @param {object} election - { id, scope, association_id } — the candidate's election.
 * @returns {boolean}
 */
function canModifyCandidate(identity, candidate, election) {
  if (!identity || !candidate) return false;
  if (candidate.created_by != null) {
    return identity.id === candidate.created_by;
  }
  // Legacy rows: no recorded creator → fall back to election management rules.
  return canManageElection(identity, election);
}

/**
 * True iff the identity may ADD or REMOVE voters (participants) of an election.
 *
 * Role-based (NOT creator-restricted): any user who may manage the election, or
 * an association election manager granted the can_add_federation_voters flag for
 * federation elections, may add/remove voters. Applies to both federation and
 * association elections.
 *
 * @param {object} identity - { id, role, association_id, can_add_federation_voters }
 * @param {object} election - { id, scope, association_id }
 * @returns {boolean}
 */
function canManageVoters(identity, election) {
  return (
    canManageElection(identity, election) ||
    canAddFederationVoters(identity, election)
  );
}

/**
 * Throws an error if the identity's association does not match the given associationId.
 * Satisfies Req 6.5, 6.6: restricts association managers to their own association.
 *
 * @param {object} identity - { id, role, association_id }
 * @param {string} associationId - The target association ID
 * @throws {Error} When identity.association_id !== associationId
 */
function assertSameAssociation(identity, associationId) {
  if (identity.association_id !== associationId) {
    const error = new Error('Access denied: you cannot access a different association');
    error.code = 'CROSS_ASSOCIATION_ACCESS_DENIED';
    throw error;
  }
}

module.exports = {
  ROLES,
  SCOPES,
  canManageFederationElection,
  canManageAssociation,
  canManageUsers,
  canManageAssociationElection,
  canCreateAssociationElection,
  canManageAssociationUsers,
  canManageMembers,
  canAddFederationVoters,
  canManageElection,
  canModifyElection,
  canModifyCandidate,
  canManageVoters,
  canViewElectionResults,
  canViewPositionResult,
  canCastBallot,
  assertSameAssociation,
};
