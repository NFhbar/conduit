/**
 * Storage-layer errors thrown by repository implementations. Kept Nest-agnostic
 * so that repositories don't depend on `@nestjs/common`. Services translate
 * these into HTTP exceptions at the application boundary.
 */

export class DuplicateIdError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
  ) {
    super(`${entity} ${id} already exists`);
    this.name = 'DuplicateIdError';
  }
}

export class EntityNotFoundError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
  ) {
    super(`${entity} ${id} not found`);
    this.name = 'EntityNotFoundError';
  }
}

/**
 * Thrown by version-checked `update` calls when the stored version doesn't
 * match the version the caller observed. The classic optimistic-concurrency
 * race: A reads at version N, B reads at version N, both compute new state,
 * both attempt to write — the second write fails fast instead of silently
 * clobbering the first.
 *
 * Services translate this to `ConflictException` (409) at the HTTP boundary;
 * the right response from a caller is to re-read and retry.
 */
export class StaleVersionError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `${entity} ${id} version conflict: caller observed ${expectedVersion}, stored is ${actualVersion}`,
    );
    this.name = 'StaleVersionError';
  }
}
