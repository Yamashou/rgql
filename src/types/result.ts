/**
 * A generic Result type for explicit error handling without exceptions.
 *
 * Discriminated on `ok`:
 * - `{ ok: true, value: T }`  — success
 * - `{ ok: false, error: E }` — failure
 *
 * @template T - The success value type.
 * @template E - The error type.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Creates a success Result.
 *
 * @postcondition Returned Result has `ok === true`.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Creates a failure Result.
 *
 * @postcondition Returned Result has `ok === false`.
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Transforms the success value of a Result, leaving errors untouched.
 *
 * @precondition `fn` must be a pure function.
 * @postcondition If `result.ok`, returns `ok(fn(result.value))`. Otherwise returns `result` unchanged.
 */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Chains a Result-producing function onto a success value (monadic bind).
 *
 * @precondition `fn` must be a pure function.
 * @postcondition If `result.ok`, returns `fn(result.value)`. Otherwise returns `result` unchanged.
 */
export function flatMapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}
