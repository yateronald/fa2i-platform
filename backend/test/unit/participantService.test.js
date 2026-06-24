import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addParticipant } from '../../src/services/electionService.js';

describe('addParticipant()', () => {
  // An association-scoped election: scoping comes from the election object.
  const election = {
    id: 'election-uuid-1',
    scope: 'ASSOCIATION',
    association_id: 'assoc-uuid-1',
  };
  const identity = {
    id: 'manager-uuid',
    role: 'ASSOCIATION_MANAGER',
    association_id: 'assoc-uuid-1',
  };

  function createMockDeps(overrides = {}) {
    const mockUsersRepository = {
      findAnyByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'new-user-uuid',
        email: 'voter@example.com',
        email_lower: 'voter@example.com',
        role: 'VOTER',
        association_id: 'assoc-uuid-1',
      }),
    };

    const mockParticipantsRepository = {
      create: vi.fn().mockResolvedValue({
        election_id: election.id,
        user_id: 'new-user-uuid',
        added_at: new Date(),
      }),
      findByEmailInElection: vi.fn().mockResolvedValue(null),
      countByElectionAndAssociation: vi.fn().mockResolvedValue(0),
    };

    const mockCredentialService = {
      generateTemporaryPassword: vi.fn().mockReturnValue('TempPass123!xyz'),
      hashPassword: vi.fn().mockResolvedValue('$2b$10$hashedvalue'),
    };

    const mockEmailService = {
      sendCredentials: vi.fn().mockResolvedValue({ success: true }),
    };

    const mockAssociationsRepository = {
      findById: vi.fn().mockResolvedValue({
        id: 'assoc-uuid-1',
        name: 'Mon Association',
        logo_ref: 'https://cdn/assoc-logo.png',
      }),
    };

    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockWithTransaction = vi.fn(async (fn) => fn(mockClient));

    return {
      usersRepository: mockUsersRepository,
      participantsRepository: mockParticipantsRepository,
      credentialService: mockCredentialService,
      emailService: mockEmailService,
      associationsRepository: mockAssociationsRepository,
      withTransaction: mockWithTransaction,
      mockClient,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('email normalization', () => {
    it('normalizes email to lowercase before lookup (global, regardless of association)', async () => {
      const deps = createMockDeps();

      await addParticipant(election, { email: 'Voter@Example.COM', fullName: 'V' }, identity, deps);

      expect(deps.usersRepository.findAnyByEmail).toHaveBeenCalledWith(
        deps.mockClient,
        'voter@example.com'
      );
    });

    it('uses the normalized email when creating a new user', async () => {
      const deps = createMockDeps();

      await addParticipant(election, { email: 'UPPER@CASE.ORG', fullName: 'U' }, identity, deps);

      expect(deps.usersRepository.create).toHaveBeenCalledWith(
        deps.mockClient,
        expect.objectContaining({ emailLower: 'upper@case.org' })
      );
    });
  });

  describe('new user creation (email not found anywhere)', () => {
    it('creates a new VOTER account with full_name when email is not found', async () => {
      const deps = createMockDeps();
      deps.usersRepository.findAnyByEmail.mockResolvedValue(null);

      await addParticipant(election, { email: 'new@voter.com', fullName: 'New Voter' }, identity, deps);

      expect(deps.usersRepository.create).toHaveBeenCalledWith(
        deps.mockClient,
        {
          email: 'new@voter.com',
          emailLower: 'new@voter.com',
          passwordHash: '$2b$10$hashedvalue',
          role: 'VOTER',
          associationId: 'assoc-uuid-1',
          fullName: 'New Voter',
        }
      );
    });

    it('generates a temporary password for the new account', async () => {
      const deps = createMockDeps();

      await addParticipant(election, { email: 'new@voter.com', fullName: 'New Voter' }, identity, deps);

      expect(deps.credentialService.generateTemporaryPassword).toHaveBeenCalled();
      expect(deps.credentialService.hashPassword).toHaveBeenCalledWith('TempPass123!xyz');
    });

    it('sends a branded credentials email (association logo + name) to the new user', async () => {
      const deps = createMockDeps();

      await addParticipant(election, { email: 'new@voter.com', fullName: 'New Voter' }, identity, deps);

      expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
        'New Voter',
        'new@voter.com',
        'TempPass123!xyz',
        { logoUrl: 'https://cdn/assoc-logo.png', brandName: 'Mon Association' }
      );
    });

    it('creates a participant record with the new user ID and reports created=true', async () => {
      const deps = createMockDeps();
      deps.usersRepository.create.mockResolvedValue({ id: 'brand-new-user' });
      deps.participantsRepository.create.mockResolvedValue({
        election_id: election.id,
        user_id: 'brand-new-user',
      });

      const result = await addParticipant(election, { email: 'new@voter.com', fullName: 'New Voter' }, identity, deps);

      expect(deps.participantsRepository.create).toHaveBeenCalledWith(
        deps.mockClient,
        { election_id: election.id, user_id: 'brand-new-user' }
      );
      expect(result).toEqual({
        success: true,
        participant: { election_id: election.id, user_id: 'brand-new-user' },
        created: true,
        existingAccount: false,
      });
    });
  });

  describe('existing user linking (email found anywhere)', () => {
    it('uses the existing user ID and does not create or email', async () => {
      const deps = createMockDeps();
      deps.usersRepository.findAnyByEmail.mockResolvedValue({ id: 'existing-user-uuid' });
      deps.participantsRepository.create.mockResolvedValue({
        election_id: election.id,
        user_id: 'existing-user-uuid',
      });

      const result = await addParticipant(election, { email: 'existing@voter.com', fullName: 'X' }, identity, deps);

      expect(deps.participantsRepository.create).toHaveBeenCalledWith(
        deps.mockClient,
        { election_id: election.id, user_id: 'existing-user-uuid' }
      );
      expect(deps.usersRepository.create).not.toHaveBeenCalled();
      expect(deps.emailService.sendCredentials).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        participant: { election_id: election.id, user_id: 'existing-user-uuid' },
        created: false,
        existingAccount: true,
      });
    });
  });

  describe('duplicate participant rejection', () => {
    it('returns error when user is already a participant (unique violation 23505)', async () => {
      const deps = createMockDeps();
      deps.usersRepository.findAnyByEmail.mockResolvedValue({ id: 'existing-user-uuid' });

      const uniqueViolation = new Error('duplicate key value violates unique constraint');
      uniqueViolation.code = '23505';
      deps.participantsRepository.create.mockRejectedValue(uniqueViolation);

      const result = await addParticipant(election, { email: 'existing@voter.com', fullName: 'X' }, identity, deps);

      expect(result).toEqual({
        success: false,
        error: 'The user is already a participant of this election',
      });
    });
  });

  describe('error propagation', () => {
    it('re-throws non-unique-violation database errors', async () => {
      const deps = createMockDeps();
      const otherError = new Error('connection refused');
      otherError.code = '08006';

      deps.withTransaction.mockRejectedValue(otherError);

      await expect(
        addParticipant(election, { email: 'voter@example.com', fullName: 'V' }, identity, deps)
      ).rejects.toThrow('connection refused');
    });
  });

  describe('federation election scoping', () => {
    const federationElection = { id: 'fed-1', scope: 'FEDERATION', association_id: null };
    // A true federation role triggers the federation-wide lookup branch.
    const fedIdentity = { id: 'fed-admin', role: 'FEDERATION_ADMINISTRATOR', association_id: null };

    it('looks up users globally and brands with the federation logo', async () => {
      process.env.FEDERATION_LOGO_URL = 'https://cdn/fed-logo.png';
      const deps = createMockDeps();

      await addParticipant(federationElection, { email: 'voter@test.com', fullName: 'Fed Voter' }, fedIdentity, deps);

      expect(deps.usersRepository.findAnyByEmail).toHaveBeenCalledWith(
        deps.mockClient,
        'voter@test.com'
      );
      expect(deps.usersRepository.create).toHaveBeenCalledWith(
        deps.mockClient,
        expect.objectContaining({ associationId: null, fullName: 'Fed Voter' })
      );
      expect(deps.emailService.sendCredentials).toHaveBeenCalledWith(
        'Fed Voter',
        'voter@test.com',
        'TempPass123!xyz',
        { logoUrl: 'https://cdn/fed-logo.png', brandName: 'FA2I' }
      );
    });

    it('forces an association manager\'s voters under their own association, ignoring supplied associationId', async () => {
      const deps = createMockDeps();
      // identity is an ASSOCIATION_MANAGER scoped to assoc-uuid-1
      await addParticipant(
        federationElection,
        { email: 'voter@test.com', fullName: 'Fed Voter', associationId: 'other-assoc' },
        identity,
        deps
      );

      // The existence lookup is global (by email only), but creation is still
      // scoped to the manager's own association, not the supplied associationId.
      expect(deps.usersRepository.findAnyByEmail).toHaveBeenCalledWith(
        deps.mockClient,
        'voter@test.com'
      );
      expect(deps.usersRepository.create).toHaveBeenCalledWith(
        deps.mockClient,
        expect.objectContaining({ associationId: 'assoc-uuid-1' })
      );
    });
  });
});
