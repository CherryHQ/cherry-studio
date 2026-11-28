import type { UserModelRow } from '@data/db/schemas/userModel'
import type { Model } from '@shared/data/types/model'
import {
  MODEL_METADATA_FIELDS,
  type ModelMetadataSources,
  type ProviderModelMetadata
} from '@shared/data/types/modelMetadata'

/** Historical values with no provenance must not be silently overwritten. */
export function getModelMetadataSources(
  row: Pick<UserModelRow, 'metadataSources' | 'contextWindow' | 'maxOutputTokens' | 'capabilities' | 'presetModelId'>,
  resolved?: Model
): ModelMetadataSources {
  if (row.metadataSources) {
    const sources = { ...row.metadataSources }
    for (const field of MODEL_METADATA_FIELDS) {
      if (sources[field] === 'unknown' && row[field] == null && resolved?.[field] !== undefined)
        sources[field] = 'registry'
    }
    return sources
  }
  return {
    contextWindow: row.contextWindow != null ? 'user' : resolved?.contextWindow !== undefined ? 'registry' : 'unknown',
    maxOutputTokens:
      row.maxOutputTokens != null ? 'user' : resolved?.maxOutputTokens !== undefined ? 'registry' : 'unknown',
    capabilities:
      row.capabilities !== null && row.capabilities !== undefined
        ? 'user'
        : row.presetModelId && row.capabilities === null
          ? 'registry'
          : 'unknown'
  }
}

/** Missing provider values never clear a prior snapshot or effective value. */
export function mergeProviderMetadata(
  previous: ProviderModelMetadata | null | undefined,
  incoming: ProviderModelMetadata
): ProviderModelMetadata {
  return { ...previous, ...incoming }
}

export function providerMetadataPatch(
  row: UserModelRow,
  incoming: ProviderModelMetadata,
  resolved: Model,
  resetField?: keyof ProviderModelMetadata
) {
  const providerMetadata = mergeProviderMetadata(row.providerMetadata, incoming)
  const metadataSources = getModelMetadataSources(row, resolved)
  const updates: {
    providerMetadata: ProviderModelMetadata
    metadataSources: ModelMetadataSources
    contextWindow?: number
    maxOutputTokens?: number
    capabilities?: Model['capabilities']
  } = { providerMetadata, metadataSources }
  for (const field of MODEL_METADATA_FIELDS) {
    const value = providerMetadata[field]
    if (value === undefined) continue
    const reset = field === resetField
    if (!reset && (!Object.hasOwn(incoming, field) || !['provider', 'unknown'].includes(metadataSources[field])))
      continue
    if (field === 'capabilities') updates.capabilities = [...(value as Model['capabilities'])]
    else updates[field] = value as number
    metadataSources[field] = 'provider'
  }
  return updates
}
