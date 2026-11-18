/** A contract case's assertion failed: the harness broke the contract the message names. */
export class ContractViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContractViolation'
  }
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContractViolation(message)
}

// Sorted keys so field order never matters; JSON.stringify already drops fields whose value is undefined.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Harness contract cases compare heterogeneous port results and fixtures; canonicalization inspects their runtime JSON representation.
const canonical = (value: unknown): string | undefined =>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON.stringify supplies nested properties and toJSON results; sort only values proven to be non-array objects.
  JSON.stringify(value, (_field, nested: unknown) =>
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : nested
  )

/** Throws unless both sides have the same canonical JSON. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Actual adapter results and expected contract fixtures span different port types; compare their canonical JSON without asserting either domain shape.
export function same(actual: unknown, expected: unknown, message: string): void {
  const got = canonical(actual)
  const want = canonical(expected)
  if (got !== want) throw new ContractViolation(`${message}: expected ${want}, got ${got}`)
}

/** Resolves to the error `run` rejected with; throws when it resolves instead. */
export async function rejects<TResult>(run: () => Promise<TResult>, message: string): Promise<Error> {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  throw new ContractViolation(message)
}
