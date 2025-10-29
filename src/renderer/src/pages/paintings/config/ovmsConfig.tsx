import type { PaintingAction } from '@renderer/types'
import { uuid } from '@renderer/utils'

// Configuration item type definition
export type ConfigItem = {
  type: 'select' | 'radio' | 'slider' | 'input' | 'switch' | 'inputNumber' | 'textarea' | 'title' | 'description'
  key?: keyof PaintingAction | 'commonModel'
  title?: string
  tooltip?: string
  options?:
    | Array<{
        label: string
        title?: string
        value?: string | number
        icon?: string
      }>
    | ((
        config: ConfigItem,
        painting: Partial<PaintingAction>
      ) => Array<{ label: string; value: string | number; icon?: string }>)
  min?: number
  max?: number
  step?: number
  suffix?: React.ReactNode
  content?: string
  disabled?: boolean | ((config: ConfigItem, painting: Partial<PaintingAction>) => boolean)
  initialValue?: string | number | boolean
  required?: boolean
  condition?: (painting: PaintingAction) => boolean
}

// Size options for OVMS
const SIZE_OPTIONS = [
  { label: '512x512', value: '512x512' },
  { label: '768x768', value: '768x768' },
  { label: '1024x1024', value: '1024x1024' }
]

// Available OVMS models for image generation - will be populated dynamically
export const OVMS_MODELS = [{ label: 'no available model', value: 'none' }]

// Function to get available OVMS models from provider
export const getOvmsModels = (
  providerModels?: Array<{ id: string; name: string }>
): Array<{ label: string; value: string }> => {
  if (!providerModels || providerModels.length === 0) {
    // Fallback to static models if no provider models
    return OVMS_MODELS
  }

  // Filter provider models for image generation (SD, Stable-Diffusion, Stable Diffusion, FLUX)
  const imageGenerationModels = providerModels.filter((model) => {
    const modelName = model.name.toLowerCase()
    return (
      modelName.startsWith('sd') ||
      modelName.startsWith('stable-diffusion') ||
      modelName.startsWith('stable diffusion') ||
      modelName.startsWith('flux')
    )
  })

  // Convert to the expected format
  const formattedModels = imageGenerationModels.map((model) => ({
    label: model.name,
    value: model.id
  }))

  // Return formatted models or fallback to static models
  return formattedModels.length > 0 ? formattedModels : OVMS_MODELS
}

// Create configuration function
export const createOvmsConfig = (models?: Array<{ label: string; value: string }>): ConfigItem[] => {
  const availableModels = models || OVMS_MODELS
  return [
    {
      type: 'select',
      key: 'model',
      title: 'paintings.model',
      options: availableModels,
      initialValue: availableModels[0]?.value || 'Select Model Here'
    },
    {
      type: 'select',
      key: 'size',
      title: 'paintings.image.size',
      options: SIZE_OPTIONS,
      initialValue: '512x512'
    },
    {
      type: 'inputNumber',
      key: 'num_inference_steps',
      title: 'paintings.inference_steps',
      tooltip: 'paintings.inference_steps_tip',
      min: 1,
      max: 100,
      initialValue: 4
    },
    {
      type: 'inputNumber',
      key: 'rng_seed',
      title: 'paintings.seed',
      tooltip: 'paintings.seed_tip',
      initialValue: 0
    }
  ]
}

// Default painting configuration for OVMS
export const DEFAULT_OVMS_PAINTING: PaintingAction = {
  id: uuid(),
  model: '',
  prompt: '',
  size: '512x512',
  num_inference_steps: 4,
  rng_seed: 0,
  files: [],
  urls: []
}

// Function to create default painting with dynamic model
export const createDefaultOvmsPainting = (models?: Array<{ label: string; value: string }>): PaintingAction => {
  const availableModels = models || OVMS_MODELS
  return {
    ...DEFAULT_OVMS_PAINTING,
    id: uuid(),
    model: availableModels[0]?.value || 'Select Model Here'
  }
}
