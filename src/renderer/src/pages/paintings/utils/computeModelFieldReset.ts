import { prefetch } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { ImageGenerationMode, ImageGenerationSupport } from '@shared/data/types/model'

import { imageGenerationToFields } from '../form/imageGenerationToFields'
import type { BaseConfigItem } from '../providers/shared/providerFieldSchema'

const logger = loggerService.withContext('paintings/modelFieldReset')

/**
 * When the user switches to a different model under the SAME provider, the
 * flat `PaintingData` struct keeps every field the prior model wrote. The
 * form correctly hides irrelevant fields (driven by the new model's registry
 * `imageGeneration` block), but the values still sit in state — and each
 * vendor's `generateUnified.ts` would otherwise forward them to the wire,
 * landing stale `aspectRatio` / `styleType` / etc. on a gpt-image-style
 * endpoint that rejects them.
 *
 * This helper diff'es the old model's form fields against the new model's
 * (via the same `imageGenerationToFields` the renderer uses) and returns a
 * patch that nulls every key that's no longer in scope. For shared option
 * fields like `size`, it also restores the new model's default when the old
 * value is not valid for the new model. Apply it alongside
 * `{ model: newModelId, ...onModelChange?.(...) }` so the painting state
 * post-switch contains exactly the fields the new model accepts.
 *
 * Returns `{}` when the old model has no registry block (custom or
 * user-named models) — that's the conservative choice: no info, no reset.
 * Cross-provider switches are already handled by the caller via
 * `createPaintingData`, which produces a fresh painting from defaults.
 */
export async function computeModelFieldReset(input: {
  providerId: string
  oldModelId: string | undefined
  newModelId: string
  providerKeyMap: Record<string, string> | undefined
  mode: ImageGenerationMode | undefined
  currentValues?: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { providerId, oldModelId, newModelId, providerKeyMap, mode, currentValues = {} } = input
  if (!oldModelId || oldModelId === newModelId) return {}

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

  const [oldSupport, newSupport] = await Promise.all([fetchSupport(oldModelId), fetchSupport(newModelId)])
  if (!oldSupport) return {}

  const oldItems = imageGenerationToFields(oldSupport, { keyMap: providerKeyMap, mode })
  const newItems = newSupport ? imageGenerationToFields(newSupport, { keyMap: providerKeyMap, mode }) : []

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
    if (!item.key || item.initialValue === undefined || Object.prototype.hasOwnProperty.call(patch, item.key)) continue
    const options = typeof item.options === 'function' ? item.options(item, currentValues) : (item.options ?? [])
    if (options.length === 0) continue

    const currentValue = currentValues[item.key]
    if (currentValue === undefined || currentValue === null || currentValue === '') continue

    const allowedValues = new Set(options.map((option) => String(option.value)))
    if (!allowedValues.has(String(currentValue))) {
      patch[item.key] = item.initialValue
    }
  }

  return patch
}
