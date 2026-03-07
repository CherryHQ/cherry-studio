/**
 * Canonical enum definitions for the catalog system.
 *
 * Re-exports proto-generated enums as the SINGLE SOURCE OF TRUTH.
 * Proto numeric enums are used everywhere — no string conversion.
 *
 * - catalog/schemas/ uses these via z.nativeEnum()
 * - shared/data/types/ re-exports these directly
 */

import {
  Currency,
  CurrencySchema,
  EndpointType,
  EndpointTypeSchema,
  Modality,
  ModalitySchema,
  ModelCapability,
  ModelCapabilitySchema,
  ReasoningEffort,
  ReasoningEffortSchema
} from '../gen/v1/common_pb'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export proto enums as canonical source of truth
// ─────────────────────────────────────────────────────────────────────────────

export { Currency, EndpointType, Modality, ModelCapability, ReasoningEffort }

// Schema descriptors for enum-to-string conversion if needed
export {
  CurrencySchema as CurrencyEnumSchema,
  EndpointTypeSchema as EndpointTypeEnumSchema,
  ModalitySchema as ModalityEnumSchema,
  ModelCapabilitySchema as ModelCapabilityEnumSchema,
  ReasoningEffortSchema as ReasoningEffortEnumSchema
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compatible aliases
// ─────────────────────────────────────────────────────────────────────────────
// These allow existing `ENDPOINT_TYPE.CHAT_COMPLETIONS` syntax to keep working.
// Values change from strings to numbers — consumers must be updated.

export const ENDPOINT_TYPE = EndpointType
export const MODEL_CAPABILITY = ModelCapability
export const MODALITY = Modality

// ─────────────────────────────────────────────────────────────────────────────
// Utility (kept for backward compatibility, will be removed with Zod schemas)
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the value tuple from a const object for use with z.enum(). */
export function objectValues<T extends Record<string, string | number>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(obj) as [T[keyof T], ...T[keyof T][]]
}
