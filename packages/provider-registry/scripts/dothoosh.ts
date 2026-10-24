/**
 * DotHoosh provider-model rows, derived from the gateway's public model listings.
 * `pnpm generate` fetches them (or reads DOTHOOSH_CACHE / DOTHOOSH_ANTHROPIC_CACHE), as it does for OpenRouter.
 */
import type { ProviderModelOverride } from '../src/schemas/provider-models'
import {
  countListedModels,
  DOTHOOSH_MIRROR_URL,
  type DotHooshModel,
  parseDotHooshListings
} from '../src/utils/dothooshListing'
import { canonOf } from './canonicalize'

export const DOTHOOSH_PROVIDER_ID = 'dothoosh'

// Keyless build-time fetch. The Iran-hosted API (gateway.dothoosh.com) is not reachable from outside
// Iran, so the generator reads the byte-for-byte public mirror behind Cloudflare.
export const DOTHOOSH_MIRROR_MODELS_URL = `${DOTHOOSH_MIRROR_URL}/v1/models`
export const DOTHOOSH_MIRROR_ANTHROPIC_MODELS_URL = `${DOTHOOSH_MIRROR_URL}/anthropic/v1/models`

function toRow(model: DotHooshModel, baseIds: ReadonlySet<string>): Partial<ProviderModelOverride> | undefined {
  const modelId = canonOf(model.id)
  if (!modelId) return undefined
  const limits = {
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {})
  }
  return {
    providerId: DOTHOOSH_PROVIDER_ID,
    modelId,
    ...(model.id !== modelId ? { apiModelId: model.id } : {}),
    // A model with no creator entry is vendor-exclusive: it needs a standalone name (catalog invariant).
    ...(baseIds.has(modelId) ? {} : { name: model.name }),
    endpointTypes: model.endpointTypes,
    ...(Object.keys(limits).length ? { limits } : {}),
    ...(model.pricing ? { pricing: model.pricing } : {}),
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    capabilities: model.capabilities
  }
}

export function dothooshProviderRows(
  listings: { openai?: unknown; anthropic?: unknown },
  baseIds: ReadonlySet<string>
): Partial<ProviderModelOverride>[] {
  const rows = parseDotHooshListings(listings).flatMap((model) => {
    const row = toRow(model, baseIds)
    return row ? [row] : []
  })
  const seen = new Set<string>()
  return rows
    .filter((row) => {
      const key = `${row.modelId} ${row.apiModelId ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => `${a.modelId} ${a.apiModelId ?? ''}`.localeCompare(`${b.modelId} ${b.apiModelId ?? ''}`))
}

/** Fewer models than this means a broken or truncated listing, never a real catalog. */
export const DOTHOOSH_MIN_MODELS = 3

/**
 * Rows for the generated catalog. On a fetch error, an unusable listing on either route, or fewer than
 * DOTHOOSH_MIN_MODELS models, the previous DotHoosh rows are kept (or DotHoosh is skipped) and the run goes on.
 */
export async function resolveDothooshRows(
  loadListings: () => Promise<{ openai: unknown; anthropic: unknown }>,
  previousRows: readonly Partial<ProviderModelOverride>[],
  baseIds: ReadonlySet<string>,
  warn: (message: string) => void
): Promise<Partial<ProviderModelOverride>[]> {
  const kept = previousRows.filter((row) => row.providerId === DOTHOOSH_PROVIDER_ID)
  const fallback = (reason: string): Partial<ProviderModelOverride>[] => {
    warn(
      kept.length
        ? `DotHoosh listing unusable (${reason}); keeping previous DotHoosh rows (${kept.length})`
        : `DotHoosh listing unusable (${reason}); skipping DotHoosh (no previous rows)`
    )
    return [...kept]
  }
  try {
    const listings = await loadListings()
    const unusable = (['openai', 'anthropic'] as const).filter((route) => countListedModels(listings[route]) === 0)
    if (unusable.length) return fallback(`no usable models in the ${unusable.join(' and ')} listing`)
    const rows = dothooshProviderRows(listings, baseIds)
    return rows.length >= DOTHOOSH_MIN_MODELS ? rows : fallback(`only ${rows.length} models`)
  } catch (error) {
    return fallback(error instanceof Error ? error.message : String(error))
  }
}
