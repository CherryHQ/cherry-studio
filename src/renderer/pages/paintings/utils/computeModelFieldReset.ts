import type { ImageOperation } from '@cherrystudio/provider-registry'
import { prefetch } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { ImageGenerationSupport } from '@shared/data/types/model'

import { type BaseConfigItem, isOptionsConfigItem } from '../form/baseConfigItem'
import { controlValue, optionalParamNumber } from '../form/fieldValue'
import { imageGenerationToFields } from '../form/imageGenerationToFields'

const logger = loggerService.withContext('paintings/modelFieldReset')

/** Remove inapplicable draft values and initialize the new model's visible defaults. */
export async function computeModelFieldReset(input: {
  providerId: string
  oldModelId: string | undefined
  newModelId: string
  operation: ImageOperation | undefined
  hasImages?: boolean
  currentValues?: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { providerId, oldModelId, newModelId, operation, hasImages = false, currentValues = {} } = input
  if (oldModelId && oldModelId === newModelId) return {}

  const fetchSupport = async (modelId: string): Promise<ImageGenerationSupport | undefined> => {
    try {
      const result = await prefetch('/providers/:providerId/models/:modelId*/image-generation-support', {
        params: { providerId, modelId }
      })
      return result ?? undefined
    } catch (error) {
      logger.warn('Failed to prefetch image-generation-support', { providerId, modelId, error })
      throw error
    }
  }

  const newSupport = await fetchSupport(newModelId)
  const newItems = newSupport ? imageGenerationToFields(newSupport, { operation, hasImages }) : []
  return computeImageFieldReset(newItems, currentValues)
}

/** Reconcile a draft when its model, operation or applicable input fields change. */
export function computeImageFieldReset(newItems: BaseConfigItem[], currentValues: Record<string, unknown>) {
  const collectKeys = (items: BaseConfigItem[]): Set<string> => {
    const keys = new Set<string>()
    for (const item of items) {
      if (item.key) keys.add(item.key)
      // Custom dimensions share one widget but must be cleared together.
      if (item.type === 'customSize') {
        keys.add(item.widthKey)
        keys.add(item.heightKey)
        keys.add(item.sizeKey)
      }
    }
    return keys
  }

  const newKeys = collectKeys(newItems)

  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(currentValues)) {
    if (!newKeys.has(key)) patch[key] = undefined
  }

  for (const item of newItems) {
    if (!item.key) continue
    if (Object.prototype.hasOwnProperty.call(patch, item.key)) continue

    const currentValue = currentValues[item.key]
    const isMissing = currentValue === undefined || currentValue === null || currentValue === ''

    // Materialize visible defaults so display and submission agree.
    if (isMissing) {
      if (item.initialValue !== undefined) patch[item.key] = item.initialValue
      continue
    }

    // Preserve explicit values only while they satisfy the new constraints.
    const options = isOptionsConfigItem(item)
      ? typeof item.options === 'function'
        ? item.options(item, currentValues)
        : item.options
      : []
    if (options.length > 0) {
      const allowedValues = new Set(options.map((option) => controlValue(option.value)))
      if (!allowedValues.has(controlValue(currentValue))) patch[item.key] = item.initialValue
      continue
    }

    if (item.type === 'slider') {
      const numeric = optionalParamNumber(item.key, currentValue)
      const outOfRange = numeric === null || numeric < item.min || numeric > item.max
      if (outOfRange) patch[item.key] = item.initialValue
    }
  }

  const nextValues = { ...currentValues, ...patch }
  for (const item of newItems) {
    if (!item.condition || item.condition(nextValues)) continue
    patch[item.key] = undefined
    if (item.type === 'customSize') {
      patch[item.widthKey] = undefined
      patch[item.heightKey] = undefined
    }
  }
  return patch
}
