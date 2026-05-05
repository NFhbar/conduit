import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_OFFSET = 0;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Internal pagination shape used by services and repositories. */
export interface PageQuery {
  offset: number;
  limit: number;
}

/** Internal page result. */
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Query-string DTO for paginated list endpoints. Both fields are optional;
 * defaults are applied at the service boundary so the type system stays
 * honest about what the wire actually sent.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}

export function resolvePageQuery(query: PaginationQueryDto): PageQuery {
  return {
    offset: query.offset ?? DEFAULT_PAGE_OFFSET,
    limit: query.limit ?? DEFAULT_PAGE_LIMIT,
  };
}

/**
 * Wire-format envelope. Self-contained; clients don't need headers to paginate.
 *
 * Structurally identical to `Page<T>` today (the only difference is the type
 * of `items`, which the generic already handles). Kept as a separate type
 * on purpose — same wire/internal split the rest of the codebase uses
 * (`Account` / `AccountResponse`, `Entry` / `EntryResponse`). The internal
 * shape is free to grow fields the wire shouldn't carry (e.g. an
 * `executionMillis` for instrumentation), and the wire shape is free to
 * grow `nextCursor` / `prevCursor` if we move off offset pagination —
 * neither change should ripple into the other. The duplication today is
 * a small cost paid up front for that flexibility.
 */
export interface PageResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export function toPageResponse<T, U>(
  page: Page<T>,
  mapItem: (item: T) => U,
): PageResponse<U> {
  return {
    items: page.items.map(mapItem),
    total: page.total,
    offset: page.offset,
    limit: page.limit,
  };
}
