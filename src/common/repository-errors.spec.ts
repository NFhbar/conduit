import { randomBusinessKey } from '../testing/factories';
import { DuplicateIdError, EntityNotFoundError } from './repository-errors';

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
