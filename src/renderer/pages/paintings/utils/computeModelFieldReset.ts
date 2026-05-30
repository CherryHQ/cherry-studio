import { prefetch } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { ImageGenerationMode, ImageGenerationSupport } from '@shared/data/types/model'

import type { BaseConfigItem } from '../form/baseConfigItem'
import { imageGenerationToFields } from '../form/imageGenerationToFields'

const logger = loggerService.withContext('paintings/modelFieldReset')

/**
 * Diff a painting's form-field state against the model it's about to use.
 * Returns a patch to merge into `painting.params` that:
 *   1. Nulls fields the old model wrote but the new model doesn't accept
 *      (otherwise stale `aspectRatio` / `styleType` / etc. would leak to the
 *      wire on a model that rejects them).
 *   2. Populates the new model's registry-declared defaults (`spec.default`)
 *      for any field the user hasn't set yet — without this, widgets display
 *      a default visually via `item.initialValue` but never commit it to
 *      state, so `canonicalGenerate` reads `undefined` and downstream code
 *      falls back to its own default (e.g. `resolveImageSize('1024x1024')`).
 *   3. Resets enum fields whose current value isn't in the new model's
 *      `options` list (cross-model carry-over of a now-invalid pick).
 *
 * Apply alongside `{ model: newModelId }` in `usePaintingModelSwitch` so
 * post-switch state contains exactly the fields the new model accepts AND
 * the visible defaults match what the wire will actually receive.
 *
 * Returns `{}` when the new model has no registry block (custom or
 * user-named models without an `imageGeneration` entry) — no info, no
 * patch. Cross-provider switches go through `createPaintingData`, which
 * starts from a clean slate; this helper handles the same-provider case
 * (including the first model selection, where `oldModelId` is undefined).
 */
export async function computeModelFieldReset(input: {
  providerId: string
  oldModelId: string | undefined
  newModelId: string
  mode: ImageGenerationMode | undefined
  currentValues?: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { providerId, oldModelId, newModelId, mode, currentValues = {} } = input
  if (oldModelId && oldModelId === newModelId) return {}

  const fetchSupport = async (modelId: string): Promise<ImageGenerationSupport | undefined> => {
    try {
      const result = await prefetch('/providers/:providerId/models/:modelId*/image-generation-support', {
        params: { providerId, modelId }
      })
      return result ?? undefined
    } catch (error) {
      logger.warn('Failed to prefetch image-generation-support', { providerId, modelId, error })
      return undefined
    }
  }

  const [oldSupport, newSupport] = await Promise.all([
    oldModelId ? fetchSupport(oldModelId) : Promise.resolve(undefined),
    fetchSupport(newModelId)
  ])

  const oldItems = oldSupport ? imageGenerationToFields(oldSupport, { mode }) : []
  const newItems = newSupport ? imageGenerationToFields(newSupport, { mode }) : []
  if (newItems.length === 0) return {}

  const collectKeys = (items: BaseConfigItem[]): Set<string> => {
    const keys = new Set<string>()
    for (const item of items) {
      if (item.key) keys.add(item.key)
      // `customSize` widget aliases multiple persisted fields under one
      // BaseConfigItem (zhipu cogview). Collect each so the reset doesn't
      // half-clear the trio.
      const widget = item as { widthKey?: string; heightKey?: string; sizeKey?: string }
      if (widget.widthKey) keys.add(widget.widthKey)
      if (widget.heightKey) keys.add(widget.heightKey)
      if (widget.sizeKey) keys.add(widget.sizeKey)
    }
    return keys
  }

  const oldKeys = collectKeys(oldItems)
  const newKeys = collectKeys(newItems)

  const patch: Record<string, unknown> = {}
  for (const key of oldKeys) {
    if (!newKeys.has(key)) patch[key] = undefined
  }

  for (const item of newItems) {
    if (!item.key || item.initialValue === undefined) continue
    if (Object.prototype.hasOwnProperty.call(patch, item.key)) continue

    const currentValue = currentValues[item.key]
    const isMissing = currentValue === undefined || currentValue === null || currentValue === ''
    if (isMissing) {
      patch[item.key] = item.initialValue
      continue
    }

    const options = typeof item.options === 'function' ? item.options(item, currentValues) : (item.options ?? [])
    if (options.length === 0) continue
    const allowedValues = new Set(options.map((option) => String(option.value)))
    if (!allowedValues.has(String(currentValue))) {
      patch[item.key] = item.initialValue
    }
  }

  return patch
}
