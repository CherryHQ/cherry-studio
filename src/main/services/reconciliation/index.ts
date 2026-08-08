// Public API of the reconciliation engine. Consumers (backup restore today, a future
// cross-device consumer) enter through this barrel only — internal modules stay private.
export { MergeEngine, MergeStrategyNotImplementedError } from './MergeEngine'
export type { MergeContext, MergeResult, ReconcileDegradationKind } from './types'
export { RECONCILE_DEGRADATION_KINDS } from './types'
