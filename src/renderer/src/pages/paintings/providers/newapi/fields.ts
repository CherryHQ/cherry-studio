import {
  getPaintingsBackgroundOptionsLabel,
  getPaintingsImageSizeOptionsLabel,
  getPaintingsModerationOptionsLabel,
  getPaintingsQualityOptionsLabel
} from '@renderer/i18n/label'

import type { BaseConfigItem } from '../shared/providerFieldSchema'
import { MODELS } from './config'

function getModelConfig(modelId: unknown) {
  return MODELS.find((model) => model.name === modelId)
}

function buildSizeField(): BaseConfigItem {
  return {
    type: 'select',
    key: 'size',
    title: 'paintings.image.size',
    condition: (painting) => {
      const modelConfig = getModelConfig(painting.model)
      return !!(modelConfig?.imageSizes && modelConfig.imageSizes.length > 0)
    },
    options: (_config, painting) => {
      const modelConfig = getModelConfig(painting.model)
      return (modelConfig?.imageSizes || []).map((size) => ({
        label: getPaintingsImageSizeOptionsLabel(size.value) ?? size.value,
        value: size.value
      }))
    }
  }
}

function buildQualityField(): BaseConfigItem {
  return {
    type: 'select',
    key: 'quality',
    title: 'paintings.quality',
    condition: (painting) => {
      const modelConfig = getModelConfig(painting.model)
      return !!(modelConfig?.quality && modelConfig.quality.length > 0)
    },
    options: (_config, painting) => {
      const modelConfig = getModelConfig(painting.model)
      return (modelConfig?.quality || []).map((quality) => ({
        label: getPaintingsQualityOptionsLabel(quality.value) ?? quality.value,
        value: quality.value
      }))
    }
  }
}

function buildModerationField(): BaseConfigItem {
  return {
    type: 'select',
    key: 'moderation',
    title: 'paintings.moderation',
    condition: (painting) => {
      const modelConfig = getModelConfig(painting.model)
      return !!(modelConfig?.moderation && modelConfig.moderation.length > 0)
    },
    options: (_config, painting) => {
      const modelConfig = getModelConfig(painting.model)
      return (modelConfig?.moderation || []).map((moderation) => ({
        label: getPaintingsModerationOptionsLabel(moderation.value) ?? moderation.value,
        value: moderation.value
      }))
    }
  }
}

function buildBackgroundField(): BaseConfigItem {
  return {
    type: 'select',
    key: 'background',
    title: 'paintings.background',
    condition: (painting) => {
      const modelConfig = getModelConfig(painting.model)
      return !!(modelConfig?.background && modelConfig.background.length > 0)
    },
    options: (_config, painting) => {
      const modelConfig = getModelConfig(painting.model)
      return (modelConfig?.background || []).map((background) => ({
        label: getPaintingsBackgroundOptionsLabel(background.value) ?? background.value,
        value: background.value
      }))
    }
  }
}

function buildCountField(): BaseConfigItem {
  return {
    type: 'inputNumber',
    key: 'n',
    title: 'paintings.number_images',
    min: 1,
    max: 10,
    condition: (painting) => !!getModelConfig(painting.model)?.max_images
  }
}

function buildConfigFields(): Record<string, BaseConfigItem[]> {
  return {
    generate: [buildSizeField(), buildQualityField(), buildModerationField(), buildCountField()],
    edit: [buildSizeField(), buildQualityField(), buildBackgroundField(), buildCountField()]
  }
}

export const newApiFields = buildConfigFields()

export function getNewApiFields() {
  return newApiFields
}
