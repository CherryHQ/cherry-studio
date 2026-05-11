import {
  EmbeddingTag,
  FreeTag,
  ReasoningTag,
  RerankerTag,
  ToolsCallingTag,
  VisionTag,
  WebSearchTag
} from '@renderer/components/Tags/Model'
import i18n from '@renderer/i18n'
import { type Model, MODEL_CAPABILITY, type ModelCapability } from '@shared/data/types/model'
import { isFreeModel } from '@shared/utils/model'
import type { FC } from 'react'
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'

export type ModelTagsWithLabelModel = Pick<Model, 'id' | 'name' | 'providerId' | 'capabilities' | 'endpointTypes'> &
  Partial<Pick<Model, 'description' | 'group'>>

interface ModelTagsProps {
  model: ModelTagsWithLabelModel
  showFree?: boolean
  showReasoning?: boolean
  showToolsCalling?: boolean
  size?: number
  showLabel?: boolean
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
    render: ({ size }) => <EmbeddingTag size={size} />
  },
  {
    capability: MODEL_CAPABILITY.RERANK,
    render: ({ size }) => <RerankerTag size={size} />
  }
] as const

const ModelTagsWithLabel: FC<ModelTagsProps> = ({
  model,
  showFree = true,
  showReasoning = true,
  showToolsCalling = true,
  size = 8,
  showLabel = true,
  showTooltip = true,
  style
}) => {
  const [shouldShowLabel, setShouldShowLabel] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeObserver = useRef<ResizeObserver | null>(null)

  const maxWidth = useMemo(() => (i18n.language.startsWith('zh') ? 300 : 350), [])

  useLayoutEffect(() => {
    const currentElement = containerRef.current
    if (!showLabel || !currentElement) return

    setShouldShowLabel(currentElement.offsetWidth >= maxWidth)

    resizeObserver.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setShouldShowLabel(entry.contentRect.width >= maxWidth)
      }
    })
    resizeObserver.current.observe(currentElement)

    return () => {
      if (resizeObserver.current) {
        resizeObserver.current.disconnect()
        resizeObserver.current = null
      }
    }
  }, [maxWidth, showLabel])

  const capabilities = new Set(model.capabilities)
  const tagProps = { size, showTooltip, showLabel: shouldShowLabel }

  return (
    <div
      ref={containerRef}
      className="flex min-w-0 max-w-full flex-row flex-wrap items-center gap-0.5 overflow-visible"
      style={style}>
      {CAPABILITY_TAGS.map(({ capability, isVisible, render }) =>
        capabilities.has(capability) && (isVisible?.({ showReasoning, showToolsCalling }) ?? true) ? (
          <span key={capability} className="inline-flex">
            {render(tagProps)}
          </span>
        ) : null
      )}
      {showFree && isFreeModel(model) && <FreeTag size={size} />}
    </div>
  )
}

export default memo(ModelTagsWithLabel)
