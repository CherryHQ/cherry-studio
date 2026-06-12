import type { Model, UniqueModelId } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'

import type { OfficialVendor } from './useAssistantPresetCatalog'

/**
 * Pure, side-effect-free resolver that picks a userModel for an
 * official-vendor preset based on the user's currently enabled models.
 *
 * Priority (highest → lowest):
 *   1. User's globally-chosen default model, if it belongs to the same vendor
 *   2. CherryIN-hosted vendor model matching the preference list (newest first)
 *   3. Direct-provider vendor model matching the preference list (newest first)
 *   4. Any CherryIN-hosted vendor model the user has enabled (preference miss)
 *   5. Any direct-provider vendor model the user has enabled (preference miss)
 *
 * Returns `null` when the user has no model belonging to that vendor → caller
 * should surface a "configure a provider" guidance flow.
 */

const CHERRYIN_PROVIDER_ID = 'cherryin'

/**
 * Per-vendor model-id preference list, ordered "closest to the official web
 * product's default" first. IDs are the registry-shipped catalog IDs from
 * packages/provider-registry/data/models.json.
 */
export const VENDOR_MODEL_PREFERENCES: Record<OfficialVendor, readonly string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  openai: ['gpt-5', 'chatgpt-4o-latest', 'gpt-5-2', 'gpt-4o', 'gpt-5-mini'],
  google: ['gemini-3-pro-preview', 'gemini-2-5-pro', 'gemini-3-flash-preview', 'gemini-2-5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-v3-2', 'deepseek-reasoner', 'deepseek-r1'],
  moonshot: ['kimi-k2-5', 'kimi-k2', 'kimi-k2-thinking-turbo'],
  doubao: ['doubao-seed-2-0-pro', 'doubao-seed-1-8', 'doubao-seed-2-0-mini', 'doubao-1-5-thinking-pro']
}

/**
 * Modal-id prefix → vendor map used to classify CherryIN-hosted models, which
 * carry the upstream vendor's modelId verbatim (CherryIN is a transparent proxy).
 * The prefix list is ordered by specificity to avoid `gpt-` matching first when
 * `chatgpt-4o-latest` is on the wire.
 */
const CHERRYIN_PREFIX_TO_VENDOR: ReadonlyArray<readonly [string, OfficialVendor]> = [
  ['claude-', 'anthropic'],
  ['chatgpt-', 'openai'],
  ['gpt-', 'openai'],
  ['o3-', 'openai'],
  ['o4-', 'openai'],
  ['gemini-', 'google'],
  ['gemma-', 'google'],
  ['deepseek-', 'deepseek'],
  ['kimi-', 'moonshot'],
  ['moonshot-', 'moonshot'],
  ['doubao-', 'doubao']
]

/**
 * Direct-provider id → vendor. The provider catalog uses these canonical IDs
 * for first-party providers (see packages/provider-registry/data/providers.json).
 * Aliases like `gemini` and `volcengine` map back to their canonical vendor.
 */
const DIRECT_PROVIDER_TO_VENDOR: Readonly<Record<string, OfficialVendor>> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  gemini: 'google',
  deepseek: 'deepseek',
  moonshot: 'moonshot',
  doubao: 'doubao',
  volcengine: 'doubao'
}

function modelIdOf(model: Model): string {
  // Prefer explicit apiModelId; fall back to parsing the deterministic id.
  if (model.apiModelId) return model.apiModelId
  return parseUniqueModelId(model.id).modelId
}

/**
 * Classify a model into one of the 6 official vendors, or return null if it
 * doesn't belong to any. Handles both direct providers (by providerId) and
 * CherryIN (by modelId prefix, since CherryIN passes IDs through unchanged).
 */
export function vendorOf(model: Model): OfficialVendor | null {
  if (model.providerId === CHERRYIN_PROVIDER_ID) {
    const id = modelIdOf(model)
    for (const [prefix, vendor] of CHERRYIN_PREFIX_TO_VENDOR) {
      if (id.startsWith(prefix)) return vendor
    }
    return null
  }
  return DIRECT_PROVIDER_TO_VENDOR[model.providerId] ?? null
}

export interface ResolveVendorModelOptions {
  /** All models known to the user (enabled + disabled + hidden). */
  models: readonly Model[]
  /** The user's globally-chosen default model id (preference `chat.default_model_id`), if any. */
  defaultModelId?: UniqueModelId | null
}

/**
 * Pick the best model id (UniqueModelId) for an official-vendor preset.
 * Returns `null` if the user has no enabled, non-hidden model for the vendor.
 */
export function resolveVendorModel(
  vendor: OfficialVendor,
  { models, defaultModelId }: ResolveVendorModelOptions
): UniqueModelId | null {
  // 1. Honor user's globally chosen default if it belongs to this vendor.
  if (defaultModelId) {
    const def = models.find((m) => m.id === defaultModelId)
    if (def && vendorOf(def) === vendor && isUsable(def)) {
      return def.id
    }
  }

  // 2. Build the usable candidate set for this vendor.
  const candidates = models.filter((m) => isUsable(m) && vendorOf(m) === vendor)
  if (candidates.length === 0) return null

  // 3. Two buckets: CherryIN-hosted (preferred) and direct-provider (fallback).
  const cherryin = candidates.filter((m) => m.providerId === CHERRYIN_PROVIDER_ID)
  const direct = candidates.filter((m) => m.providerId !== CHERRYIN_PROVIDER_ID)
  const preferences = VENDOR_MODEL_PREFERENCES[vendor]

  // 4. Within each bucket, walk the preference list in order; first hit wins.
  for (const preferredId of preferences) {
    const hit = cherryin.find((m) => modelIdOf(m) === preferredId) ?? direct.find((m) => modelIdOf(m) === preferredId)
    if (hit) return hit.id
  }

  // 5. Preference miss → still return *something* the user enabled.
  const fallback = cherryin[0] ?? direct[0]
  return fallback.id
}

function isUsable(model: Model): boolean {
  return model.isEnabled === true
}
