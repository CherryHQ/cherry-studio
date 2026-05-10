import type { BaseConfigItem } from '../shared/providerFieldSchema'
import type { AihubmixMode, ConfigItem } from './config'
import { createModeConfigs } from './config'

const modeConfigs = createModeConfigs()

const MODE_TO_CONFIG: Record<'generate' | 'remix' | 'upscale', AihubmixMode> = {
  generate: 'aihubmix_image_generate',
  remix: 'aihubmix_image_remix',
  upscale: 'aihubmix_image_upscale'
}

// ConfigItem extends the shared BaseConfigItem schema with aihubmix-specific field types.
// The cast is safe: the renderer field pipeline reads ConfigItem fields at runtime.
export const aihubmixFields: Record<string, BaseConfigItem[]> = {
  generate: modeConfigs.aihubmix_image_generate.filter((item) => item.key !== 'model') as unknown as BaseConfigItem[],
  remix: modeConfigs.aihubmix_image_remix.filter((item) => item.key !== 'model') as unknown as BaseConfigItem[],
  upscale: modeConfigs.aihubmix_image_upscale.filter((item) => item.key !== 'model') as unknown as BaseConfigItem[]
}

export type { ConfigItem }

export function getStaticModelsForAihubmixMode(mode: 'generate' | 'remix' | 'upscale') {
  const configKey = MODE_TO_CONFIG[mode]
  const modelItem = modeConfigs[configKey].find((item) => item.key === 'model')
  if (!modelItem || !Array.isArray(modelItem.options)) return []

  const result: Array<{ label: string; value: string; group?: string }> = []
  for (const option of modelItem.options) {
    if (option.options && Array.isArray(option.options)) {
      for (const sub of option.options) {
        result.push({
          label: sub.label || String(sub.value),
          value: String(sub.value),
          group: option.label || option.title
        })
      }
    } else if (option.value !== undefined) {
      result.push({
        label: option.label || String(option.value),
        value: String(option.value)
      })
    }
  }

  return result
}
