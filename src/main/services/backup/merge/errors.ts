/** A requested conflict strategy is intentionally deferred to a later merge iteration. */
export class MergeStrategyNotImplementedError extends Error {
  constructor(strategy: string) {
    super(`merge strategy not implemented: ${strategy}`)
    this.name = 'MergeStrategyNotImplementedError'
  }
}
