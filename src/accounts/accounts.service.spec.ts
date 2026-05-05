import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DuplicateIdError } from '../common/repository-errors';
import {
  randomAmount,
  randomBusinessKey,
  randomName,
  randomUuid,
} from '../testing/factories';
import { dollarsToCents } from '../domain/money';
import { AccountsRepository } from './accounts.repository';
import { InMemoryAccountsRepository } from './accounts.repository.in-memory';
import { AccountsService } from './accounts.service';

describe('AccountsService', () => {
  let repo: InMemoryAccountsRepository;
  let service: AccountsService;

  beforeEach(() => {
    repo = new InMemoryAccountsRepository();
    service = new AccountsService(repo);
  });

  it('creates an account with a caller-supplied id (any non-empty string)', () => {
    const id = randomUuid();
    const name = randomName();
    const account = service.create({ id, direction: 'debit', name });

    expect(account.id).toBe(id);
    expect(account.direction).toBe('debit');
    expect(account.name).toBe(name);
    expect(account.balanceCents).toBe(0);
  });

  it('accepts a non-UUID business-key id', () => {
    const id = randomBusinessKey('acc');
    const account = service.create({ id, direction: 'credit' });
    expect(account.id).toBe(id);
  });

  it('generates a uuid when id is not provided', () => {
    const account = service.create({ direction: 'credit' });
    expect(account.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('honors a non-zero opening balance with exact cent precision', () => {
    const dollars = randomAmount();
    const account = service.create({ direction: 'debit', balance: dollars });
    const expected = dollarsToCents(dollars);
    expect(account.balanceCents).toBe(expected);
    // Reconciliation depends on these starting equal at creation.
    expect(account.openingBalanceCents).toBe(expected);
  });

  it('throws ConflictException on duplicate id', () => {
    const id = randomBusinessKey();
    service.create({ id, direction: 'debit' });
    expect(() => service.create({ id, direction: 'credit' })).toThrow(
      ConflictException,
    );
  });

  it('findById returns the stored account', () => {
    const created = service.create({ direction: 'debit' });
    expect(service.findById(created.id)).toEqual(created);
  });

  it('findById throws NotFoundException when missing', () => {
    expect(() => service.findById(randomBusinessKey('missing'))).toThrow(
      NotFoundException,
    );
  });

  it('rejects an opening balance with more than two decimal places (defensive)', () => {
    // Reachable from non-HTTP callers that bypass the DTO; the DTO catches
    // this for HTTP traffic via @IsNumber({ maxDecimalPlaces: 2 }).
    expect(() =>
      service.create({ direction: 'debit', balance: 100.555 }),
    ).toThrow(BadRequestException);
  });

  it('honors an injected clock and sets createdAt === updatedAt at creation', () => {
    const now = new Date('2026-05-05T10:00:00.000Z');
    const account = service.create({ direction: 'debit' }, now);
    expect(account.createdAt).toBe('2026-05-05T10:00:00.000Z');
    expect(account.updatedAt).toBe('2026-05-05T10:00:00.000Z');
  });

  it('list delegates to the repository and returns the page envelope', () => {
    service.create({ direction: 'debit' });
    service.create({ direction: 'credit' });
    const page = service.list({ offset: 0, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(10);
  });

  describe('defensive translation of repository errors', () => {
    // The pre-check above this catch makes the throw unreachable in normal
    // single-threaded flow. The catch exists to guard a future race between
    // pre-check and commit (e.g. under an async backend). Exercise the
    // translation directly with a stubbed repository.

    it('translates DuplicateIdError from repo.create into ConflictException', () => {
      const stubRepo: AccountsRepository = {
        create: jest.fn(() => {
          throw new DuplicateIdError('account', 'race');
        }),
        findById: jest.fn().mockReturnValue(undefined),
        findAll: jest.fn().mockReturnValue([]),
        findPage: jest
          .fn()
          .mockReturnValue({ items: [], total: 0, offset: 0, limit: 20 }),
        update: jest.fn(),
      };
      const racingService = new AccountsService(stubRepo);

      expect(() => racingService.create({ direction: 'debit' })).toThrow(
        ConflictException,
      );
    });

    it('rethrows unrecognized errors from repo.create unchanged', () => {
      class CustomError extends Error {}
      const stubRepo: AccountsRepository = {
        create: jest.fn(() => {
          throw new CustomError('something else');
        }),
        findById: jest.fn().mockReturnValue(undefined),
        findAll: jest.fn().mockReturnValue([]),
        findPage: jest
          .fn()
          .mockReturnValue({ items: [], total: 0, offset: 0, limit: 20 }),
        update: jest.fn(),
      };
      const racingService = new AccountsService(stubRepo);

      expect(() => racingService.create({ direction: 'debit' })).toThrow(
        CustomError,
      );
    });
  });
});
