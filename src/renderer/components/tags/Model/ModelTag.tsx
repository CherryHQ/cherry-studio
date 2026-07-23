import { type Model, MODEL_CAPABILITY, type ModelCapability, type ModelTag } from '@shared/data/types/model'
import { isFreeModel } from '@shared/utils/model'
import type { ComponentType } from 'react'

import type { CustomTagProps } from '../CustomTag'
import { EmbeddingTag } from './EmbeddingTag'
import { FreeTag } from './FreeTag'
import { ReasoningTag } from './ReasoningTag'
import { RerankerTag } from './RerankerTag'
import { ToolsCallingTag } from './ToolsCallingTag'
import { VisionTag } from './VisionTag'
import { WebSearchTag } from './WebSearchTag'

export type ModelDisplayTagSource = Pick<Model, 'id' | 'name' | 'providerId' | 'capabilities'>

export const MODEL_DISPLAY_CAPABILITY_TAGS = [
  MODEL_CAPABILITY.IMAGE_RECOGNITION,
  MODEL_CAPABILITY.WEB_SEARCH,
  MODEL_CAPABILITY.REASONING,
  MODEL_CAPABILITY.FUNCTION_CALL,
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK
] as const satisfies readonly ModelCapability[]

export const MODEL_DISPLAY_TAGS = [...MODEL_DISPLAY_CAPABILITY_TAGS, 'free'] as const satisfies readonly ModelTag[]

export type ModelDisplayCapabilityTag = (typeof MODEL_DISPLAY_CAPABILITY_TAGS)[number]
export type ModelDisplayTag = (typeof MODEL_DISPLAY_TAGS)[number]

export interface ModelTagVisibilityOptions {
  showFree?: boolean
  showReasoning?: boolean
  showToolsCalling?: boolean
}

export function isModelTagVisible(
  tag: ModelDisplayTag,
  { showFree = true, showReasoning = true, showToolsCalling = true }: ModelTagVisibilityOptions = {}
) {
  if (tag === 'free') {
    return showFree
  }

  if (tag === MODEL_CAPABILITY.REASONING) {
    return showReasoning
  }

  if (tag === MODEL_CAPABILITY.FUNCTION_CALL) {
    return showToolsCalling
  }

  return true
}

export function modelMatchesDisplayTag(model: ModelDisplayTagSource, tag: ModelDisplayTag) {
  if (tag === 'free') {
    return isFreeModel(model)
  }

  return model.capabilities.includes(tag)
}

export function getModelDisplayTags(model: ModelDisplayTagSource, options?: ModelTagVisibilityOptions) {
  return MODEL_DISPLAY_TAGS.filter((tag) => isModelTagVisible(tag, options) && modelMatchesDisplayTag(model, tag))
}

export type ModelTagProps = {
  tag: ModelDisplayTag
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

type ModelTagComponentProps = Omit<ModelTagProps, 'tag'>

const MODEL_TAG_COMPONENTS = {
  'image-recognition': VisionTag,
  'web-search': WebSearchTag,
  reasoning: ReasoningTag,
  'function-call': ToolsCallingTag,
  embedding: EmbeddingTag,
  rerank: RerankerTag,
  free: FreeTag
} satisfies Record<ModelDisplayTag, ComponentType<ModelTagComponentProps>>

export function ModelTag({ tag, size = 12, showTooltip, showLabel = false, ...restProps }: ModelTagProps) {
  const TagComponent = MODEL_TAG_COMPONENTS[tag]

  return <TagComponent size={size} showTooltip={showTooltip} showLabel={showLabel} {...restProps} />
}
