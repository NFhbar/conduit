/**
 * The cached outcome of a previously-processed idempotent request.
 * `body` holds whatever the controller returned (success path) or whatever
 * the exception's `getResponse()` produced (error path); both are replayed
 * verbatim on subsequent requests with the same `Idempotency-Key`.
 */
export interface CachedResponse {
  /** SHA-256 of the JSON-stringified request body, used to detect "same key, different body" misuse. */
  bodyFingerprint: string;
  statusCode: number;
  body: unknown;
}
