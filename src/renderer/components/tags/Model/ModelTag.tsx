import type { ComponentType } from 'react'

import type { ModelDisplayTag } from '@renderer/utils/model'

import type { CustomTagProps } from '../CustomTag'
import { AudioTag } from './AudioTag'
import { EmbeddingTag } from './EmbeddingTag'
import { FreeTag } from './FreeTag'
import { ReasoningTag } from './ReasoningTag'
import { RerankerTag } from './RerankerTag'
import { ToolsCallingTag } from './ToolsCallingTag'
import { VideoTag } from './VideoTag'
import { VisionTag } from './VisionTag'
import { WebSearchTag } from './WebSearchTag'

export {
  getModelDisplayTags,
  isModelTagVisible,
  MODEL_DISPLAY_CAPABILITY_TAGS,
  MODEL_DISPLAY_TAGS,
  type ModelDisplayCapabilityTag,
  type ModelDisplayTag,
  type ModelDisplayTagSource,
  modelMatchesDisplayTag,
  type ModelTagVisibilityOptions
} from '@renderer/utils/model'

export type ModelTagProps = {
  tag: ModelDisplayTag
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

type ModelTagComponentProps = Omit<ModelTagProps, 'tag'>

const MODEL_TAG_COMPONENTS = {
  'image-recognition': VisionTag,
  'audio-recognition': AudioTag,
  'video-recognition': VideoTag,
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
