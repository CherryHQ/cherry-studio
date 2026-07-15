/**
 * Bound convenience API over the creator-declared reasoning family rules
 * (#16598). This module contains NO family knowledge: rules are DATA in
 * `Creator.reasoningFamilies` (creators/*.ts), compiled by generation into
 * `reasoning-families.gen.ts`; the matcher lives in `reasoning-families.ts`.
 * Adding a new model family = a data edit in its creator + `pnpm generate`.
 *
 * Consumed at INGEST time only — never as a runtime capability source:
 *  - `ModelService` infers controls when a custom-provider model row is
 *    created (or read) without a descriptor;
 *  - `@shared/utils/model.findTokenLimit` delegates its legacy budget
 *    fallback here until the legacy tower is deleted.
 * (The generation script consumes the pure matcher + CREATORS directly, so
 * it never depends on the generated artifact.)
 */
import type { ReasoningControl } from '../schemas/model'
import { matchReasoningControls, matchTokenLimits } from './reasoning-families'
import { REASONING_FAMILY_RULES } from './reasoning-families.gen'

/**
 * Infer a model's reasoning controls from its id. Returns `undefined` when no
 * family rule matches — callers gate on the model actually being
 * reasoning-capable; rules only know the KNOBS. The wire dialect is NOT part
 * of the result: it follows the serving provider's endpoint declaration.
 */
export function inferReasoningControls(rawModelId: string): ReasoningControl[] | undefined {
  return matchReasoningControls(rawModelId, REASONING_FAMILY_RULES)
}

/**
 * Thinking-token limits for a raw model id (legacy `findTokenLimit`
 * semantics — tests the RAW string, so `provider::model` unique ids match).
 */
export function findHeuristicTokenLimits(rawModelId: string): { min: number; max: number } | undefined {
  return matchTokenLimits(rawModelId, REASONING_FAMILY_RULES)
}
