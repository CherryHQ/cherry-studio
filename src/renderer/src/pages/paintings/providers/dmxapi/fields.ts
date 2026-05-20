import { generationModeType } from '../../model/types/paintingData'
import { STYLE_TYPE_OPTIONS } from './config'
import { getDmxapiModelMeta } from './runtime'

export function buildDmxapiConfigFields(): any[] {
  return [
    {
      type: 'sizeChips',
      key: 'image_size',
      title: 'paintings.image.size',
      options: (_config: any, painting: Record<string, unknown>) => {
        const meta = getDmxapiModelMeta(painting.model as string | undefined)
        const sizes = (meta?.image_sizes || []).map((size) => ({
          label: size.label,
          value: size.value
        }))
        if (meta?.is_custom_size) {
          sizes.push({ label: 'paintings.custom_size', value: 'custom' })
        }
        return sizes
      }
    },
    {
      type: 'customSize',
      key: 'customSize',
      title: 'paintings.custom_size',
      widthKey: 'customWidth',
      heightKey: 'customHeight',
      sizeKey: 'image_size',
      condition: (painting: Record<string, unknown>) => {
        if (painting.image_size !== 'custom' && !String(painting.image_size || '').match(/^\d+x\d+$/)) return false
        const meta = getDmxapiModelMeta(painting.model as string | undefined)
        if (!meta?.is_custom_size) return false
        const presetValues = (meta?.image_sizes || []).map((size) => size.value)
        return !presetValues.includes(String(painting.image_size))
      },
      validation: {
        minWidth: 512,
        maxWidth: 2048,
        minHeight: 512,
        maxHeight: 2048
      }
    },
    {
      type: 'input',
      key: 'seed',
      title: 'paintings.seed',
      tooltip: 'paintings.seed_desc_tip',
      condition: (painting: Record<string, unknown>) => {
        return painting.generationMode === generationModeType.GENERATION
      }
    },
    {
      type: 'styleToggle',
      key: 'style_type',
      title: 'paintings.style_type',
      toggleMode: 'single' as const,
      options: STYLE_TYPE_OPTIONS.map((style) => ({
        labelKey: style.labelKey,
        value: style.value
      }))
    },
    {
      type: 'switch',
      key: 'autoCreate',
      title: 'paintings.auto_create_paint',
      tooltip: 'paintings.auto_create_paint_tip'
    }
  ]
}
