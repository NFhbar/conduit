import { randomBusinessKey } from '../testing/factories';
import {
  DuplicateIdError,
  EntityNotFoundError,
  StaleVersionError,
} from './repository-errors';

describe('DuplicateIdError', () => {
  it('carries entity and id, formats a message, and is identifiable via instanceof', () => {
    const id = randomBusinessKey();
    const err = new DuplicateIdError('account', id);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DuplicateIdError);
    expect(err.entity).toBe('account');
    expect(err.id).toBe(id);
    expect(err.message).toBe(`account ${id} already exists`);
    expect(err.name).toBe('DuplicateIdError');
  });
});

describe('EntityNotFoundError', () => {
  it('carries entity and id, formats a message, and is identifiable via instanceof', () => {
    const id = randomBusinessKey();
    const err = new EntityNotFoundError('transaction', id);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EntityNotFoundError);
    expect(err.entity).toBe('transaction');
    expect(err.id).toBe(id);
    expect(err.message).toBe(`transaction ${id} not found`);
    expect(err.name).toBe('EntityNotFoundError');
  });
});

describe('StaleVersionError', () => {
  it('carries entity, id, expected/actual versions, formats a message, and is identifiable via instanceof', () => {
    const id = randomBusinessKey();
    const err = new StaleVersionError('account', id, 3, 5);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StaleVersionError);
    expect(err.entity).toBe('account');
    expect(err.id).toBe(id);
    expect(err.expectedVersion).toBe(3);
    expect(err.actualVersion).toBe(5);
    expect(err.message).toBe(
      `account ${id} version conflict: caller observed 3, stored is 5`,
    );
    expect(err.name).toBe('StaleVersionError');
  });
});
