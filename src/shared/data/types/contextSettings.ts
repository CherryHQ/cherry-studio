/**
 * Context-settings types for the context-build (chef) layer.
 *
 * Three shapes, by purpose:
 * - `ContextSettingsOverride` — a per-layer PARTIAL (assistant / topic).
 *   Every field optional; `undefined` means "inherit from the layer below".
 * - `EffectiveContextSettings` — the fully-resolved object the request
 *   pipeline consumes (no undefineds), produced by `resolveContextSettings`.
 * - `DEFAULT_CONTEXT_SETTINGS` — the hardcoded floor under the global prefs.
 *
 * `compress.modelId` is a plain `string | null` (NOT `UniqueModelId`) so it
 * matches the auto-generated preference schema's boundary; validation to a
 * real model happens in `resolveCompressionModel`. `null` = "no explicit
 * pick"; the caller falls back to the current request model.
 */
import * as z from 'zod'

export const ContextSettingsCompressOverrideSchema = z.object({
  enabled: z.boolean(),
  modelId: z.string().nullable().optional()
})
export type ContextSettingsCompressOverride = z.infer<typeof ContextSettingsCompressOverrideSchema>

export const ContextSettingsOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  truncateThreshold: z.number().int().positive().optional(),
  compress: ContextSettingsCompressOverrideSchema.partial().optional()
})
export type ContextSettingsOverride = z.infer<typeof ContextSettingsOverrideSchema>

export const EffectiveContextSettingsSchema = z.object({
  enabled: z.boolean(),
  truncateThreshold: z.number().int().positive(),
  compress: z.object({
    enabled: z.boolean(),
    modelId: z.string().nullable()
  })
})
export type EffectiveContextSettings = z.infer<typeof EffectiveContextSettingsSchema>

/** Hardcoded floor. compress.enabled defaults TRUE (P2-B decision); the
 *  threshold mirrors CONTEXT_PERSIST_THRESHOLD_CHARS so the persist trigger
 *  and the default agree out of the box. */
export const DEFAULT_CONTEXT_SETTINGS: EffectiveContextSettings = {
  enabled: true,
  truncateThreshold: 100_000,
  compress: {
    enabled: true,
    modelId: null
  }
}
