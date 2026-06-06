import {
  EmbeddingTag,
  FreeTag,
  ReasoningTag,
  RerankerTag,
  ToolsCallingTag,
  VisionTag,
  WebSearchTag
} from '@renderer/components/Tags/Model'
import { type Model, MODEL_CAPABILITY, type ModelCapability } from '@shared/data/types/model'
import { isFreeModel } from '@shared/utils/model'
import type { FC } from 'react'
import { memo } from 'react'

export type ModelTagsWithLabelModel = Pick<Model, 'id' | 'name' | 'providerId' | 'capabilities' | 'endpointTypes'> &
  Partial<Pick<Model, 'description' | 'group'>>

interface ModelTagsProps {
  model: ModelTagsWithLabelModel
  showFree?: boolean
  showReasoning?: boolean
  showToolsCalling?: boolean
  size?: number
  showTooltip?: boolean
  style?: React.CSSProperties
}

type CapabilityTagConfig = {
  capability: ModelCapability
  isVisible?: (props: Pick<ModelTagsProps, 'showReasoning' | 'showToolsCalling'>) => boolean
  render: (props: { size: number; showTooltip: boolean; showLabel: boolean }) => React.ReactNode
}

const CAPABILITY_TAGS: readonly CapabilityTagConfig[] = [
  {
    capability: MODEL_CAPABILITY.IMAGE_RECOGNITION,
    render: (props) => <VisionTag {...props} />
  },
  {
    capability: MODEL_CAPABILITY.WEB_SEARCH,
    render: (props) => <WebSearchTag {...props} />
  },
  {
    capability: MODEL_CAPABILITY.REASONING,
    isVisible: ({ showReasoning }) => showReasoning !== false,
    render: (props) => <ReasoningTag {...props} />
  },
  {
    capability: MODEL_CAPABILITY.FUNCTION_CALL,
    isVisible: ({ showToolsCalling }) => showToolsCalling !== false,
    render: (props) => <ToolsCallingTag {...props} />
  },
  {
    capability: MODEL_CAPABILITY.EMBEDDING,
    render: (props) => <EmbeddingTag {...props} />
  },
  {
    capability: MODEL_CAPABILITY.RERANK,
    render: (props) => <RerankerTag {...props} />
  }
] as const

const ModelTagsWithLabel: FC<ModelTagsProps> = ({
  model,
  showFree = true,
  showReasoning = true,
  showToolsCalling = true,
  size = 8,
  showTooltip = true,
  style
}) => {
  const capabilities = new Set(model.capabilities)
  const tagProps = { size, showTooltip, showLabel: false }

  return (
    <div className="flex min-w-0 max-w-full flex-row flex-wrap items-center gap-0.5 overflow-visible" style={style}>
      {CAPABILITY_TAGS.map(({ capability, isVisible, render }) =>
        capabilities.has(capability) && (isVisible?.({ showReasoning, showToolsCalling }) ?? true) ? (
          <span key={capability} className="inline-flex">
            {render(tagProps)}
          </span>
        ) : null
      )}
      {showFree && isFreeModel(model) && <FreeTag {...tagProps} />}
    </div>
  )
}

export default memo(ModelTagsWithLabel)
