// Shared because main derives the routing table and the renderer renders it: main ranks the models,
// the settings screen shows the ranking and why each model placed where it did.

import type { TaskCategory } from '../preference/preferenceTypes'
import type { UniqueModelId } from './model'

/** A ranked model plus its score breakdown, so the UI can explain a pick instead of asserting it. */
export type RoutingCandidate = {
  id: UniqueModelId
  score: number
  /** Capability tier from the model's name, 0-100. */
  quality: number
  /** How well the model's declared capabilities suit this category. */
  affinity: number
  /** Bonus when the last probe passed, penalty when it failed, zero when never probed. */
  healthDelta: number
  /** Penalty when every declared key ceiling for the provider is spent. */
  quotaDelta: number
}

export type DerivedRoutingTable = Record<TaskCategory, RoutingCandidate[]>

export const EMPTY_DERIVED_ROUTING_TABLE: DerivedRoutingTable = {
  code: [],
  research: [],
  writing: [],
  image: [],
  general: []
}
