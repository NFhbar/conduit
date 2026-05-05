import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import {
  IDEMPOTENCY_REPOSITORY,
  IdempotencyRepository,
} from './idempotency.repository';

const HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 255;
// Every POST in this API today is mutating, so method is a sufficient proxy
// for "should idempotency apply". The first non-mutating POST (a `POST /search`
// or similar) silently inheriting idempotency caching would be wrong; revisit
// this filter when that day comes (likely via a `@SkipIdempotency()` decorator
// + `Reflector` lookup).
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Implements `Idempotency-Key` semantics roughly per Stripe's contract:
 *
 *  - When the header is present on a state-changing request, the response
 *    (success body or 4xx `HttpException` payload) is cached against the key.
 *  - Subsequent requests with the same key replay the original outcome —
 *    same status, same body — without re-running the handler.
 *  - A request whose body fingerprint differs from the original is rejected
 *    with 409 to surface the misuse rather than silently replaying.
 *
 * Scope: GETs are skipped (already idempotent at the HTTP layer); only
 * POST/PUT/PATCH/DELETE participate.
 *
 * Cache namespacing: the cache key is `${method} ${path}\0${header}` so the
 * same client-supplied `Idempotency-Key` value used on two different routes
 * lives in two separate buckets — matches Stripe's `(account, route, method, key)`
 * scoping pattern.
 *
 * Cached statuses: 2xx success and 4xx `HttpException`. 5xx `HttpException`s
 * are deliberately *not* cached: a `ServiceUnavailableException` etc. is
 * usually transient, and pinning the failure for the lifetime of the key
 * defeats the very retry the caller would want. Raw `Error`s also bypass
 * the cache for the same reason — a programmer bug shouldn't replay.
 *
 * Known limitations on this in-memory v1:
 *   - No TTL — entries live for the process lifetime.
 *   - No "request in progress" fencing. Two concurrent requests with the
 *     same key would both miss the cache and execute. Single-threaded Node
 *     + synchronous handlers make this unreachable on one instance today;
 *     a multi-instance or async-DB future needs an atomic check-and-set on
 *     the repository.
 *   - Body fingerprint is `sha256(JSON.stringify(body))` — order-sensitive.
 *     Fine for machine-to-machine clients; humans constructing JSON by
 *     hand could trip it. Trade-off recorded in the README's `Decisions`.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(IDEMPOTENCY_REPOSITORY)
    private readonly repo: IdempotencyRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      return next.handle();
    }

    const rawKey = req.header(HEADER);
    if (rawKey === undefined) {
      return next.handle();
    }

    const idempotencyKey = rawKey.trim();
    if (idempotencyKey.length === 0) {
      throw new BadRequestException(
        `'Idempotency-Key' header must be non-empty when present`,
      );
    }
    if (idempotencyKey.length > MAX_KEY_LENGTH) {
      throw new BadRequestException(
        `'Idempotency-Key' header must be at most ${MAX_KEY_LENGTH} characters`,
      );
    }

    const cacheKey = composeCacheKey(req.method, req.path, idempotencyKey);
    // Fingerprint runs against the raw parsed JSON body (interceptors run
    // before pipes in Nest's pipeline), so two requests with the same logical
    // payload but different extraneous fields will produce different
    // fingerprints — `whitelist: true` strips them later, but we lock the
    // contract on the bytes the client actually sent. Intentional.
    const bodyFingerprint = fingerprint(req.body);
    const cached = this.repo.findByKey(cacheKey);

    if (cached) {
      if (cached.bodyFingerprint !== bodyFingerprint) {
        throw new ConflictException(
          `Idempotency-Key '${idempotencyKey}' was previously used with a different request body`,
        );
      }
      // Replay: error responses go through the exception filter so the
      // response shape is identical to the original; success responses set
      // the status manually and return the cached body.
      if (cached.statusCode >= 400) {
        throw new HttpException(cached.body as object, cached.statusCode);
      }
      const res = context.switchToHttp().getResponse<Response>();
      res.status(cached.statusCode);
      return of(cached.body);
    }

    return next.handle().pipe(
      tap((body) => {
        const res = context.switchToHttp().getResponse<Response>();
        this.repo.save(cacheKey, {
          bodyFingerprint,
          statusCode: res.statusCode,
          body,
        });
      }),
      catchError((err: unknown) => {
        // Cache only client-error `HttpException`s (4xx). 5xx exceptions and
        // raw `Error`s pass through unscathed — both are usually transient
        // and pinning their response for the lifetime of the key would block
        // the retry the caller wants.
        if (err instanceof HttpException && isClientError(err.getStatus())) {
          this.repo.save(cacheKey, {
            bodyFingerprint,
            statusCode: err.getStatus(),
            body: err.getResponse(),
          });
        }
        return throwError(() => err);
      }),
    );
  }
}

function composeCacheKey(method: string, path: string, key: string): string {
  return `${method} ${path}\0${key}`;
}

function isClientError(status: number): boolean {
  return status >= 400 && status < 500;
}

function fingerprint(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
}
