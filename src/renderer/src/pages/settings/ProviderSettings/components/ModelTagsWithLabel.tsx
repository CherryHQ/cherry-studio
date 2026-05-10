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
import {
  isEmbeddingModel,
  isFreeModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel,
  type ProviderSettingsDisplayModel
} from '@renderer/pages/settings/ProviderSettings/config/models'
import type { FC } from 'react'
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'

interface ModelTagsProps {
  model: ProviderSettingsDisplayModel
  showFree?: boolean
  showReasoning?: boolean
  showToolsCalling?: boolean
  size?: number
  showLabel?: boolean
  showTooltip?: boolean
  style?: React.CSSProperties
}

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

  return (
    <div
      ref={containerRef}
      className="flex min-w-0 max-w-full flex-row flex-wrap items-center gap-0.5 overflow-visible"
      style={style}>
      {isVisionModel(model) && <VisionTag size={size} showTooltip={showTooltip} showLabel={shouldShowLabel} />}
      {isWebSearchModel(model) && <WebSearchTag size={size} showTooltip={showTooltip} showLabel={shouldShowLabel} />}
      {showReasoning && isReasoningModel(model) && (
        <ReasoningTag size={size} showTooltip={showTooltip} showLabel={shouldShowLabel} />
      )}
      {showToolsCalling && isFunctionCallingModel(model) && (
        <ToolsCallingTag size={size} showTooltip={showTooltip} showLabel={shouldShowLabel} />
      )}
      {isEmbeddingModel(model) && <EmbeddingTag size={size} />}
      {showFree && isFreeModel(model) && <FreeTag size={size} />}
      {isRerankModel(model) && <RerankerTag size={size} />}
    </div>
  )
}

export default memo(ModelTagsWithLabel)
