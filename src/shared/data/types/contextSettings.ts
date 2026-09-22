/**
 * Context-settings types for the context-build (chef) layer.
 *
 * Three shapes, by purpose:
 * - `ContextSettingsOverride` — the assistant-level PARTIAL. Every field
 *   optional; `undefined` means "inherit from the globals".
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
  // min(1): '' would read as an explicit pick and silently kill compression
  // (resolveCompressionModel('') → null) — clearing must be expressed as null.
  modelId: z.string().min(1).nullable().optional(),
  /** Compact once the prompt passes this percent of the available input context. */
  thresholdPercent: z.number().int().min(20).max(100).optional()
})
export type ContextSettingsCompressOverride = z.infer<typeof ContextSettingsCompressOverrideSchema>

export const ContextSettingsOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  truncateThreshold: z.number().int().positive().optional(),
  /**
   * Serve only the last N messages (v1 contextCount successor). Three-state:
   * absent inherits the layer below, `null` is an explicit "no limit here" that
   * overrides a finite global. The UI's empty field maps to `null`, not to
   * absent — otherwise an assistant showing "unlimited" would silently inherit
   * a finite global.
   */
  maxMessages: z.number().int().min(1).nullable().optional(),
  compress: ContextSettingsCompressOverrideSchema.partial().optional()
})
export type ContextSettingsOverride = z.infer<typeof ContextSettingsOverrideSchema>

// Never `.parse()`d in production, so these guards are not enforced at the
// boundary — consumers clamp instead (`normalizeMaxMessages`, the threshold floor).
export const EffectiveContextSettingsSchema = z.object({
  enabled: z.boolean(),
  truncateThreshold: z.number().int().positive(),
  /** Serve only the last N messages; null = unlimited. */
  maxMessages: z.number().int().min(1).nullable(),
  compress: z.object({
    enabled: z.boolean(),
    modelId: z.string().nullable(),
    thresholdPercent: z.number().int().min(20).max(100)
  })
})
export type EffectiveContextSettings = z.infer<typeof EffectiveContextSettingsSchema>

/**
 * Smallest truncate threshold any layer may store.
 *
 * The setting is not only a persistence trigger: it is handed to `fs_read` as
 * that request's per-call output cap, and every line fs_read returns carries a
 * 7-character gutter (`padStart(6)` + tab). A threshold near 1 therefore makes
 * even a single-line page exceed the cap, so `fs_read` answers
 * `output-too-large` forever and persisted output can never be read back.
 *
 * Lives here rather than in the main-process constants so both settings UIs
 * (global panel and assistant dialog) can clamp against the same number — the
 * renderer must not import from `@main`.
 */
export const MIN_TRUNCATE_THRESHOLD = 2000

/**
 * Bounds for the compaction trigger, shared by both settings UIs and the
 * resolver (clamped by `clampThresholdPercent` in `@shared/utils`). Above 100
 * the trigger can never fire; the floor keeps it clear of the keep budget,
 * which is sized as a fraction of the trigger itself.
 */
export const MIN_COMPRESS_THRESHOLD_PERCENT = 20
export const MAX_COMPRESS_THRESHOLD_PERCENT = 100

/** Hardcoded floor. compress.enabled defaults TRUE (P2-B decision); the
 *  threshold mirrors CONTEXT_PERSIST_THRESHOLD_CHARS so the persist trigger
 *  and the default agree out of the box. */
export const DEFAULT_CONTEXT_SETTINGS: EffectiveContextSettings = {
  enabled: true,
  truncateThreshold: 50_000,
  maxMessages: null,
  compress: {
    enabled: true,
    modelId: null,
    thresholdPercent: 80
  }
}
