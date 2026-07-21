/**
 * Bound convenience API over the creator-declared reasoning family rules
 * (#16598). This module contains NO family knowledge: rules are DATA in
 * `Creator.reasoningFamilies` (creators/*.ts), compiled by generation into
 * `reasoning-families.gen.ts`; the matcher lives in `reasoning-families.ts`.
 * Adding a new model family = a data edit in its creator + `pnpm generate`.
 *
 * Consumed at INGEST time only — never as a runtime capability source:
 *  - `ModelService` infers controls when a custom-provider model row is
 *    created (or read) without a descriptor.
 * (The generation script consumes the pure matcher + CREATORS directly, so
 * it never depends on the generated artifact.)
 */
import type { ReasoningControl } from '../schemas/model'
import { matchReasoningControls } from './reasoning-families'
import { REASONING_FAMILY_RULES } from './reasoning-families.gen'
import { matchReasoningMembership } from './reasoning-membership'

/**
 * Is this id a reasoning model at all? The ingest MEMBERSHIP gate consulted
 * before `inferReasoningControls` supplies the knobs. Membership is implied
 * by the same rule table: PROFILE rules grant it, TEMPLATE rules (broad
 * knob-shape carriers like the `^qwen` toggle) don't. Skip it when the
 * model's REASONING capability is already declared.
 */
export function inferReasoningMembership(rawModelId: string): boolean {
  return matchReasoningMembership(rawModelId, REASONING_FAMILY_RULES)
}

/**
 * Infer a model's reasoning controls from its id. Returns `undefined` when no
 * family rule matches — callers gate on the model actually being
 * reasoning-capable; rules only know the KNOBS. The wire dialect is NOT part
 * of the result: it follows the serving provider's endpoint declaration.
 */
export function inferReasoningControls(rawModelId: string): ReasoningControl[] | undefined {
  return matchReasoningControls(rawModelId, REASONING_FAMILY_RULES)
}
