import {
  applyModelCapabilityOverride,
  endpointDefaultOperationCapability,
  getModelOperationCapabilities
} from '../src/registry-utils'
import { MODEL_CAPABILITY, type ModelCapability } from '../src/schemas/enums'
import type { ProviderModelOverride } from '../src/schemas/provider-models'

/**
 * Decide the row's operation capabilities. Identity (a standalone row's `name`) is the caller's —
 * `baseCapabilities === undefined` cannot tell a legitimate standalone from a base id that no longer
 * resolves, so repairing identity here would let the second silently pass the catalog invariant.
 */
export function normalizeProviderModelOperations(
  row: ProviderModelOverride,
  baseCapabilities: readonly ModelCapability[] | undefined
): ProviderModelOverride {
  const normalized = row
  const effectiveCapabilities = applyModelCapabilityOverride(baseCapabilities ?? [], normalized.capabilities)
  if (getModelOperationCapabilities(effectiveCapabilities).length > 0) return normalized

  const endpointOperations = [
    ...new Set(
      (normalized.endpointTypes ?? [])
        .map(endpointDefaultOperationCapability)
        .filter((operation) => operation !== undefined)
    )
  ]
  const inheritedOperations = getModelOperationCapabilities(baseCapabilities ?? [])
  const inferredOperations = normalized.imageGeneration
    ? [MODEL_CAPABILITY.IMAGE_GENERATION]
    : endpointOperations.length > 0
      ? endpointOperations
      : inheritedOperations.length > 0
        ? inheritedOperations
        : [MODEL_CAPABILITY.TEXT_GENERATION]

  if (normalized.capabilities?.force) {
    return {
      ...normalized,
      capabilities: {
        ...normalized.capabilities,
        force: [...new Set([...normalized.capabilities.force, ...inferredOperations])]
      }
    }
  }

  if (baseCapabilities !== undefined) return normalized
  return {
    ...normalized,
    capabilities: {
      ...normalized.capabilities,
      add: [...new Set([...(normalized.capabilities?.add ?? []), ...inferredOperations])]
    }
  }
}
