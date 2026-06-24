import { describe, it, expect } from 'vitest';
import {
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
  canViewElectionResults,
  canViewPositionResult,
  canCastBallot,
  assertSameAssociation,
} from '../../src/services/accessControlService.js';

// --- Helpers ---

function fedAdmin(id = 'fa-1') {
  return { id, role: ROLES.FEDERATION_ADMINISTRATOR, association_id: null };
}

function fedElectionManager(id = 'fem-1') {
  return { id, role: ROLES.FEDERATION_ELECTION_MANAGER, association_id: null };
}

function assocManager(associationId = 'assoc-1', id = 'am-1') {
  return { id, role: ROLES.ASSOCIATION_MANAGER, association_id: associationId };
}

function assocElectionManager(associationId = 'assoc-1', id = 'aem-1', canAddFederationVoters = false) {
  return {
    id,
    role: ROLES.ASSOCIATION_ELECTION_MANAGER,
    association_id: associationId,
    can_add_federation_voters: canAddFederationVoters,
  };
}

function voter(associationId = 'assoc-1', id = 'v-1') {
  return { id, role: ROLES.VOTER, association_id: associationId };
}

function federationElection(id = 'elec-fed-1') {
  return { id, scope: SCOPES.FEDERATION, association_id: null };
}

function associationElection(associationId = 'assoc-1', id = 'elec-assoc-1') {
  return { id, scope: SCOPES.ASSOCIATION, association_id: associationId };
}

// --- canManageFederationElection ---

describe('canManageFederationElection', () => {
  it('returns true for a federation administrator', () => {
    expect(canManageFederationElection(fedAdmin())).toBe(true);
  });

  it('returns true for a federation election manager', () => {
    expect(canManageFederationElection(fedElectionManager())).toBe(true);
  });

  it('returns false for an association manager', () => {
    expect(canManageFederationElection(assocManager())).toBe(false);
  });

  it('returns false for a voter', () => {
    expect(canManageFederationElection(voter())).toBe(false);
  });
});

// --- canManageUsers ---

describe('canManageUsers', () => {
  it('returns true for a federation administrator', () => {
    expect(canManageUsers(fedAdmin())).toBe(true);
  });

  it('returns false for a federation election manager', () => {
    expect(canManageUsers(fedElectionManager())).toBe(false);
  });

  it('returns false for an association manager', () => {
    expect(canManageUsers(assocManager())).toBe(false);
  });

  it('returns false for a voter', () => {
    expect(canManageUsers(voter())).toBe(false);
  });
});

// --- canManageAssociation ---

describe('canManageAssociation', () => {
  it('returns true for a federation administrator', () => {
    expect(canManageAssociation(fedAdmin())).toBe(true);
  });

  it('returns false for an association manager', () => {
    expect(canManageAssociation(assocManager())).toBe(false);
  });

  it('returns false for a voter', () => {
    expect(canManageAssociation(voter())).toBe(false);
  });
});

// --- canManageAssociationElection ---

describe('canManageAssociationElection', () => {
  it('returns false for a federation administrator (Req 1.5, 19.2)', () => {
    const election = associationElection('assoc-1');
    expect(canManageAssociationElection(fedAdmin(), election)).toBe(false);
  });

  it('returns true for an association manager of the same association', () => {
    const identity = assocManager('assoc-1');
    const election = associationElection('assoc-1');
    expect(canManageAssociationElection(identity, election)).toBe(true);
  });

  it('returns false for an association manager of a different association', () => {
    const identity = assocManager('assoc-2');
    const election = associationElection('assoc-1');
    expect(canManageAssociationElection(identity, election)).toBe(false);
  });

  it('returns false for a voter', () => {
    const election = associationElection('assoc-1');
    expect(canManageAssociationElection(voter('assoc-1'), election)).toBe(false);
  });

  it('returns false when identity.association_id is null', () => {
    const identity = { id: 'am-x', role: ROLES.ASSOCIATION_MANAGER, association_id: null };
    const election = associationElection('assoc-1');
    expect(canManageAssociationElection(identity, election)).toBe(false);
  });

  it('returns false when election.association_id is null', () => {
    const identity = assocManager('assoc-1');
    const election = { id: 'elec-x', scope: SCOPES.ASSOCIATION, association_id: null };
    expect(canManageAssociationElection(identity, election)).toBe(false);
  });
});

// --- canManageElection ---

describe('canManageElection', () => {
  it('returns false when election is missing', () => {
    expect(canManageElection(fedAdmin(), null)).toBe(false);
    expect(canManageElection(fedAdmin(), undefined)).toBe(false);
  });

  describe('FEDERATION election', () => {
    it('returns true for a federation administrator', () => {
      expect(canManageElection(fedAdmin(), federationElection())).toBe(true);
    });

    it('returns true for a federation election manager', () => {
      expect(canManageElection(fedElectionManager(), federationElection())).toBe(true);
    });

    it('returns false for an association manager', () => {
      expect(canManageElection(assocManager('assoc-1'), federationElection())).toBe(false);
    });

    it('returns false for a voter', () => {
      expect(canManageElection(voter('assoc-1'), federationElection())).toBe(false);
    });
  });

  describe('ASSOCIATION election', () => {
    it('returns true only for the association manager of that association', () => {
      const election = associationElection('assoc-1');
      expect(canManageElection(assocManager('assoc-1'), election)).toBe(true);
    });

    it('returns false for a manager of a different association', () => {
      const election = associationElection('assoc-1');
      expect(canManageElection(assocManager('assoc-2'), election)).toBe(false);
    });

    it('returns false for a federation administrator', () => {
      const election = associationElection('assoc-1');
      expect(canManageElection(fedAdmin(), election)).toBe(false);
    });

    it('returns false for a federation election manager', () => {
      const election = associationElection('assoc-1');
      expect(canManageElection(fedElectionManager(), election)).toBe(false);
    });

    it('returns false for a voter', () => {
      const election = associationElection('assoc-1');
      expect(canManageElection(voter('assoc-1'), election)).toBe(false);
    });
  });
});

// --- canViewElectionResults ---
describe('canViewElectionResults', () => {
  it('allows federation admin to view any election results regardless of state', () => {
    const election = associationElection('assoc-1');
    expect(canViewElectionResults(fedAdmin(), election, { isParticipant: false, isClosed: false })).toBe(true);
    expect(canViewElectionResults(fedAdmin(), election, { isParticipant: false, isClosed: true })).toBe(true);
  });

  it('allows federation admin to view federation election results', () => {
    const election = federationElection();
    expect(canViewElectionResults(fedAdmin(), election, { isParticipant: false, isClosed: false })).toBe(true);
  });

  it('allows a federation election manager to view federation election results', () => {
    const election = federationElection();
    expect(canViewElectionResults(fedElectionManager(), election, { isParticipant: false, isClosed: false })).toBe(true);
  });

  it('denies a federation election manager from viewing association election results (non-participant)', () => {
    const election = associationElection('assoc-1');
    expect(canViewElectionResults(fedElectionManager(), election, { isParticipant: false, isClosed: true })).toBe(false);
  });

  it('allows association manager to view their own association election results', () => {
    const identity = assocManager('assoc-1');
    const election = associationElection('assoc-1');
    expect(canViewElectionResults(identity, election, { isParticipant: false, isClosed: false })).toBe(true);
  });

  it('denies association manager from viewing another association election results', () => {
    const identity = assocManager('assoc-2');
    const election = associationElection('assoc-1');
    expect(canViewElectionResults(identity, election, { isParticipant: false, isClosed: false })).toBe(false);
  });

  it('allows a participant to view results after election is closed', () => {
    const identity = voter('assoc-1');
    const election = associationElection('assoc-1');
    expect(canViewElectionResults(identity, election, { isParticipant: true, isClosed: true })).toBe(true);
  });

  it('denies a participant from viewing results while election is open', () => {
    const identity = voter('assoc-1');
    const election = associationElection('assoc-1');
    expect(canViewElectionResults(identity, election, { isParticipant: true, isClosed: false })).toBe(false);
  });

  it('denies a non-participant voter from viewing results even when closed', () => {
    const identity = voter('assoc-1');
    const election = associationElection('assoc-1');
    expect(canViewElectionResults(identity, election, { isParticipant: false, isClosed: true })).toBe(false);
  });

  it('denies a voter who is not a participant and election is open', () => {
    const identity = voter('assoc-1');
    const election = federationElection();
    expect(canViewElectionResults(identity, election, { isParticipant: false, isClosed: false })).toBe(false);
  });
});

// --- canCastBallot ---

describe('canCastBallot', () => {
  it('allows a participant in a federation election to cast a ballot', () => {
    const identity = voter('assoc-1');
    const election = federationElection();
    expect(canCastBallot(identity, election, { isParticipant: true })).toBe(true);
  });

  it('allows a participant in an association election of the same association', () => {
    const identity = voter('assoc-1');
    const election = associationElection('assoc-1');
    expect(canCastBallot(identity, election, { isParticipant: true })).toBe(true);
  });

  it('denies a non-participant from casting a ballot in a federation election', () => {
    const identity = voter('assoc-1');
    const election = federationElection();
    expect(canCastBallot(identity, election, { isParticipant: false })).toBe(false);
  });

  it('denies a non-participant from casting a ballot in an association election', () => {
    const identity = voter('assoc-1');
    const election = associationElection('assoc-1');
    expect(canCastBallot(identity, election, { isParticipant: false })).toBe(false);
  });

  it('denies a participant in an association election of a different association', () => {
    const identity = voter('assoc-2');
    const election = associationElection('assoc-1');
    expect(canCastBallot(identity, election, { isParticipant: true })).toBe(false);
  });

  it('allows a federation admin who is a participant to cast a ballot in a federation election', () => {
    const identity = fedAdmin();
    const election = federationElection();
    expect(canCastBallot(identity, election, { isParticipant: true })).toBe(true);
  });

  it('denies a federation admin who is not a participant', () => {
    const identity = fedAdmin();
    const election = federationElection();
    expect(canCastBallot(identity, election, { isParticipant: false })).toBe(false);
  });
});

// --- assertSameAssociation ---

describe('assertSameAssociation', () => {
  it('does not throw when association_id matches', () => {
    const identity = assocManager('assoc-1');
    expect(() => assertSameAssociation(identity, 'assoc-1')).not.toThrow();
  });

  it('throws when association_id does not match', () => {
    const identity = assocManager('assoc-1');
    expect(() => assertSameAssociation(identity, 'assoc-2')).toThrow(
      'Access denied: you cannot access a different association'
    );
  });

  it('thrown error has CROSS_ASSOCIATION_ACCESS_DENIED code', () => {
    const identity = assocManager('assoc-1');
    try {
      assertSameAssociation(identity, 'assoc-2');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe('CROSS_ASSOCIATION_ACCESS_DENIED');
    }
  });

  it('throws when identity.association_id is null', () => {
    const identity = { id: 'x', role: ROLES.ASSOCIATION_MANAGER, association_id: null };
    expect(() => assertSameAssociation(identity, 'assoc-1')).toThrow();
  });

  it('throws when identity.association_id is undefined', () => {
    const identity = { id: 'x', role: ROLES.ASSOCIATION_MANAGER, association_id: undefined };
    expect(() => assertSameAssociation(identity, 'assoc-1')).toThrow();
  });
});

// --- canManageAssociationElection (ASSOCIATION_ELECTION_MANAGER) ---

describe('canManageAssociationElection (election manager)', () => {
  it('returns true for an association election manager of the same association', () => {
    const identity = assocElectionManager('assoc-1');
    const election = associationElection('assoc-1');
    expect(canManageAssociationElection(identity, election)).toBe(true);
  });

  it('returns false for an association election manager of a different association', () => {
    const identity = assocElectionManager('assoc-2');
    const election = associationElection('assoc-1');
    expect(canManageAssociationElection(identity, election)).toBe(false);
  });
});

// --- canCreateAssociationElection ---

describe('canCreateAssociationElection', () => {
  it('returns true for an association manager with an association', () => {
    expect(canCreateAssociationElection(assocManager('assoc-1'))).toBe(true);
  });

  it('returns true for an association election manager with an association', () => {
    expect(canCreateAssociationElection(assocElectionManager('assoc-1'))).toBe(true);
  });

  it('returns false when association_id is null', () => {
    const identity = { id: 'x', role: ROLES.ASSOCIATION_MANAGER, association_id: null };
    expect(canCreateAssociationElection(identity)).toBe(false);
  });

  it('returns false for a federation administrator', () => {
    expect(canCreateAssociationElection(fedAdmin())).toBe(false);
  });

  it('returns false for a voter', () => {
    expect(canCreateAssociationElection(voter('assoc-1'))).toBe(false);
  });
});

// --- canManageAssociationUsers ---

describe('canManageAssociationUsers', () => {
  it('returns true for an association manager with an association', () => {
    expect(canManageAssociationUsers(assocManager('assoc-1'))).toBe(true);
  });

  it('returns true for a federation administrator', () => {
    expect(canManageAssociationUsers(fedAdmin())).toBe(true);
  });

  it('returns false for an association election manager', () => {
    expect(canManageAssociationUsers(assocElectionManager('assoc-1'))).toBe(false);
  });

  it('returns false when association_id is null for an association manager', () => {
    const identity = { id: 'x', role: ROLES.ASSOCIATION_MANAGER, association_id: null };
    expect(canManageAssociationUsers(identity)).toBe(false);
  });

  it('returns false for a federation election manager', () => {
    expect(canManageAssociationUsers(fedElectionManager())).toBe(false);
  });

  it('returns false for a voter', () => {
    expect(canManageAssociationUsers(voter('assoc-1'))).toBe(false);
  });
});

// --- canAddFederationVoters ---

describe('canAddFederationVoters', () => {
  it('returns true for a federation administrator on a federation election', () => {
    expect(canAddFederationVoters(fedAdmin(), federationElection())).toBe(true);
  });

  it('returns true for a federation election manager on a federation election', () => {
    expect(canAddFederationVoters(fedElectionManager(), federationElection())).toBe(true);
  });

  it('returns true for an association manager on a federation election', () => {
    expect(canAddFederationVoters(assocManager('assoc-1'), federationElection())).toBe(true);
  });

  it('returns true for an association election manager with the flag set', () => {
    const identity = assocElectionManager('assoc-1', 'aem-1', true);
    expect(canAddFederationVoters(identity, federationElection())).toBe(true);
  });

  it('returns false for an association election manager without the flag', () => {
    const identity = assocElectionManager('assoc-1', 'aem-1', false);
    expect(canAddFederationVoters(identity, federationElection())).toBe(false);
  });

  it('returns false on an association-scope election even for the manager', () => {
    const election = associationElection('assoc-1');
    expect(canAddFederationVoters(assocManager('assoc-1'), election)).toBe(false);
  });

  it('returns false for a voter', () => {
    expect(canAddFederationVoters(voter('assoc-1'), federationElection())).toBe(false);
  });

  it('returns false when election is missing', () => {
    expect(canAddFederationVoters(fedAdmin(), null)).toBe(false);
  });
});

// --- canViewElectionResults (ASSOCIATION_ELECTION_MANAGER) ---

describe('canViewElectionResults (election manager)', () => {
  it('allows an association election manager to view their own association election results', () => {
    const identity = assocElectionManager('assoc-1');
    const election = associationElection('assoc-1');
    expect(canViewElectionResults(identity, election, { isParticipant: false, isClosed: false })).toBe(true);
  });

  it('denies an association election manager from viewing another association election results', () => {
    const identity = assocElectionManager('assoc-2');
    const election = associationElection('assoc-1');
    expect(canViewElectionResults(identity, election, { isParticipant: false, isClosed: false })).toBe(false);
  });
});

// --- canViewPositionResult ---

describe('canViewPositionResult', () => {
  it('allows a federation manager to view a federation position regardless of state', () => {
    const election = federationElection();
    for (const state of ['DRAFT', 'PENDING', 'OPEN', 'CLOSED']) {
      expect(
        canViewPositionResult(fedAdmin(), election, { isParticipant: false, positionState: state })
      ).toBe(true);
    }
  });

  it('allows the association manager of the election to view regardless of state', () => {
    const election = associationElection('assoc-1');
    expect(
      canViewPositionResult(assocManager('assoc-1'), election, { isParticipant: false, positionState: 'OPEN' })
    ).toBe(true);
    expect(
      canViewPositionResult(assocManager('assoc-1'), election, { isParticipant: false, positionState: 'PENDING' })
    ).toBe(true);
  });

  it('denies an association manager from a different association who is not a participant', () => {
    const election = associationElection('assoc-1');
    expect(
      canViewPositionResult(assocManager('assoc-2'), election, { isParticipant: false, positionState: 'CLOSED' })
    ).toBe(false);
  });

  it('allows a participant only when the position is CLOSED', () => {
    const election = associationElection('assoc-1');
    expect(
      canViewPositionResult(voter('assoc-1'), election, { isParticipant: true, positionState: 'CLOSED' })
    ).toBe(true);
  });

  it('denies a participant while the position is OPEN or PENDING', () => {
    const election = associationElection('assoc-1');
    expect(
      canViewPositionResult(voter('assoc-1'), election, { isParticipant: true, positionState: 'OPEN' })
    ).toBe(false);
    expect(
      canViewPositionResult(voter('assoc-1'), election, { isParticipant: true, positionState: 'PENDING' })
    ).toBe(false);
    expect(
      canViewPositionResult(voter('assoc-1'), election, { isParticipant: true, positionState: 'DRAFT' })
    ).toBe(false);
  });

  it('denies a non-participant non-manager even when the position is CLOSED', () => {
    const election = associationElection('assoc-1');
    expect(
      canViewPositionResult(voter('assoc-2'), election, { isParticipant: false, positionState: 'CLOSED' })
    ).toBe(false);
  });
});

// --- canManageMembers ---

describe('canManageMembers', () => {
  it('returns true for an association manager with an association', () => {
    expect(canManageMembers(assocManager('assoc-1'))).toBe(true);
  });

  it('returns true for an association election manager with the can_manage_members flag', () => {
    const identity = {
      id: 'aem-1',
      role: ROLES.ASSOCIATION_ELECTION_MANAGER,
      association_id: 'assoc-1',
      can_manage_members: true,
    };
    expect(canManageMembers(identity)).toBe(true);
  });

  it('returns false for an association election manager without the flag', () => {
    const identity = {
      id: 'aem-1',
      role: ROLES.ASSOCIATION_ELECTION_MANAGER,
      association_id: 'assoc-1',
      can_manage_members: false,
    };
    expect(canManageMembers(identity)).toBe(false);
  });

  it('returns false for an association manager without an association', () => {
    const identity = { id: 'x', role: ROLES.ASSOCIATION_MANAGER, association_id: null };
    expect(canManageMembers(identity)).toBe(false);
  });

  it('returns false for an election manager with the flag but no association', () => {
    const identity = {
      id: 'x',
      role: ROLES.ASSOCIATION_ELECTION_MANAGER,
      association_id: null,
      can_manage_members: true,
    };
    expect(canManageMembers(identity)).toBe(false);
  });

  it('returns false for a federation administrator (members are association-only)', () => {
    expect(canManageMembers(fedAdmin())).toBe(false);
  });

  it('returns false for a federation election manager', () => {
    expect(canManageMembers(fedElectionManager())).toBe(false);
  });

  it('returns false for a voter', () => {
    expect(canManageMembers(voter('assoc-1'))).toBe(false);
  });

  it('returns false for a missing identity', () => {
    expect(canManageMembers(null)).toBe(false);
    expect(canManageMembers(undefined)).toBe(false);
  });
});
