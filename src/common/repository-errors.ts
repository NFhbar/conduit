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
