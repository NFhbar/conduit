// `pagination.ts` uses `class-validator` decorators on its DTO. Decorator
// runtime metadata requires `reflect-metadata`; other specs pick it up
// transitively via `@nestjs/testing`, but this spec doesn't touch Nest.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  DEFAULT_PAGE_LIMIT,
  DEFAULT_PAGE_OFFSET,
  Page,
  PaginationQueryDto,
  resolvePageQuery,
  toPageResponse,
} from './pagination';

describe('resolvePageQuery', () => {
  it('applies defaults when both fields are absent', () => {
    expect(resolvePageQuery({})).toEqual({
      offset: DEFAULT_PAGE_OFFSET,
      limit: DEFAULT_PAGE_LIMIT,
    });
  });

  it('honors caller-supplied values', () => {
    expect(resolvePageQuery({ offset: 5, limit: 10 })).toEqual({
      offset: 5,
      limit: 10,
    });
  });

  it('only fills in the missing field', () => {
    expect(resolvePageQuery({ offset: 7 })).toEqual({
      offset: 7,
      limit: DEFAULT_PAGE_LIMIT,
    });
    expect(resolvePageQuery({ limit: 50 })).toEqual({
      offset: DEFAULT_PAGE_OFFSET,
      limit: 50,
    });
  });
});

describe('PaginationQueryDto', () => {
  it('coerces query-string numbers via class-transformer (@Type(() => Number))', () => {
    // Query parameters arrive as strings; the DTO's @Type decorators turn
    // them into numbers before validation runs in the global ValidationPipe.
    const dto = plainToInstance(PaginationQueryDto, {
      offset: '5',
      limit: '10',
    });
    expect(dto.offset).toBe(5);
    expect(dto.limit).toBe(10);
    expect(typeof dto.offset).toBe('number');
    expect(typeof dto.limit).toBe('number');
  });
});

describe('toPageResponse', () => {
  it('maps each item through the provided function and preserves the envelope fields', () => {
    const internal: Page<{ id: number }> = {
      items: [{ id: 1 }, { id: 2 }],
      total: 5,
      offset: 0,
      limit: 2,
    };
    const response = toPageResponse(internal, (item) => `item-${item.id}`);
    expect(response).toEqual({
      items: ['item-1', 'item-2'],
      total: 5,
      offset: 0,
      limit: 2,
    });
  });

  it('handles an empty page', () => {
    const response = toPageResponse(
      { items: [], total: 0, offset: 0, limit: 20 },
      (x: unknown) => x,
    );
    expect(response).toEqual({ items: [], total: 0, offset: 0, limit: 20 });
  });
});
