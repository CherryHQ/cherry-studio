/** Root runs have a bounded request loop and top-level tool admission budget. Child policy stays with its meter. */
export const PI_RUN_LIMIT = 20
export const PI_RUN_LIMIT_MESSAGE =
  'The Pi agent reached its per-run tool or request limit before producing a final answer. Try again or reduce the task scope.'

// Keep refusal provenance on the exact native response without changing its persisted contents.
// Public input settlement is emitted separately from the behavior run's ending.
const refusals = new WeakMap<object, string>()
export const recordRunRefusal = (message: object, reason: string): void => {
  refusals.set(message, reason)
}
export const runRefusal = (message: object): string | undefined => refusals.get(message)
