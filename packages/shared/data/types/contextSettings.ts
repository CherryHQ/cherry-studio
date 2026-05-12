/**
 * Context settings (chef integration).
 *
 * Three-layer model:
 *   1. Global preferences (`chat.context_settings.*`) — always present
 *   2. Assistant override — partial; undefined fields inherit from global
 *   3. Topic override — partial; undefined fields inherit from assistant
 *
 * Resolution at request time is per-field:
 *   `topic.field ?? assistant.field ?? globals.field`
 *
 * Compression model resolution chain (per-request):
 *   1. effective.compress.modelId (explicit pick at any layer)
 *   2. preference `topic.naming.model_id` (user's default fast model)
 *   3. null → skip LLM compression, fall back to onBeforeCompress
 *      sliding-window drop in chef wiring
 */

import * as z from 'zod'

/**
 * Compression sub-config — `enabled` is required when present so a
 * partial override can deliberately turn it off (vs. absent = inherit).
 * `modelId` is optional at every layer; resolution chain handles
 * fallback to the user's topic-naming model.
 *
 * NOTE: `modelId` is intentionally typed as plain `string` (not
 * `UniqueModelIdSchema`). The "providerId::modelId" format is an
 * invariant the UI/picker maintains, but the same value flows through
 * preferences (`chat.context_settings.compress.model_id`) which is
 * declared as `string | null` in the auto-generated preference
 * schemas. Keeping the type plain avoids a type clash at the boundary
 * — runtime validation lives in `resolveCompressionModel`, which
 * checks `isUniqueModelId` before resolving.
 */
export const ContextSettingsCompressOverrideSchema = z.object({
  enabled: z.boolean(),
  modelId: z.string().nullable().optional()
})
export type ContextSettingsCompressOverride = z.infer<typeof ContextSettingsCompressOverrideSchema>

/**
 * Per-layer override. Every field is optional — `undefined` means
 * inherit from the parent layer. The whole object itself is also
 * optional at each layer (no override at all).
 */
export const ContextSettingsOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  truncateThreshold: z.number().int().positive().optional(),
  compress: ContextSettingsCompressOverrideSchema.optional()
})
export type ContextSettingsOverride = z.infer<typeof ContextSettingsOverrideSchema>

/**
 * Fully resolved settings — every field is set. This is what the
 * request pipeline (`contextBuildFeature`, prompt sections) consumes
 * after `resolveContextSettings` collapses the three layers + global
 * defaults + compression-model fallback chain.
 *
 * `compress.modelId` here is the FINAL resolved model id (after
 * fallback to topic.naming.model_id). It is `null` when the user
 * neither set an explicit compression model nor a naming model — chef
 * skips LLM compression and falls back to onBeforeCompress sliding
 * window in that case.
 */
export const EffectiveContextSettingsSchema = z.object({
  enabled: z.boolean(),
  truncateThreshold: z.number().int().positive(),
  compress: z.object({
    enabled: z.boolean(),
    modelId: z.string().nullable()
  })
})
export type EffectiveContextSettings = z.infer<typeof EffectiveContextSettingsSchema>

/**
 * Global defaults baked into the codebase. These match the values
 * shipped via `target-key-definitions.json` for `chat.context_settings.*`.
 * Kept in sync by hand — preferences are the runtime source of truth;
 * this constant is the fallback when preferences fail to load.
 */
export const DEFAULT_CONTEXT_SETTINGS: EffectiveContextSettings = {
  enabled: true,
  truncateThreshold: 100000,
  compress: {
    enabled: false,
    modelId: null
  }
}
