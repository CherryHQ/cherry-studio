/**
 * Exhaustiveness guard for discriminated unions.
 *
 * Call it in the `default` branch of a `switch` over a union's discriminant (or
 * after an `if`/`else` chain) that is meant to handle every variant. The `never`
 * parameter makes adding a new variant a compile error at every such call site
 * until a matching branch is added. Reaching it at runtime means the value was
 * not actually one of the known variants — that is a bug, so it throws.
 *
 * Use this only where the input is trusted to be a known variant (internal,
 * already-validated data). At an untrusted boundary (e.g. corrupt or
 * forward-versioned persisted data) prefer dropping the value with an inline
 * `const _exhaustive: never = value` guard so a downgrade never crashes.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`)
}
