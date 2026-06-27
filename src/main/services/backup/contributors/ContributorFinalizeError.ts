// ContributorFinalizeError — thrown when ContributorManager.finalize() detects a
// violation of one of the 25 registry invariants (registry.md). The payload carries
// the minimum locator (invariant id + domain/table/sourceType/owner) so a startup
// failure points straight at the offending declaration.
export interface ContributorFinalizePayload {
  /** Which invariant (1-25, per registry.md) was violated. */
  readonly invariant: number
  readonly domain?: string
  readonly table?: string
  readonly owner?: string
  readonly sourceType?: string
  readonly [key: string]: unknown
}

export class ContributorFinalizeError extends Error {
  readonly invariant: number
  readonly payload: ContributorFinalizePayload

  constructor(payload: ContributorFinalizePayload) {
    const detail = Object.entries(payload)
      .filter(([key]) => key !== 'invariant')
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ')
    super(`backup contributor finalize invariant #${payload.invariant} violated: ${detail}`)
    this.name = 'ContributorFinalizeError'
    this.invariant = payload.invariant
    this.payload = payload
  }
}
