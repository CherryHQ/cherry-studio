import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import i18n from '@renderer/i18n'
import { Model } from '@renderer/types'
import { isFreeModel } from '@renderer/utils/model'
import { FC, memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

import {
  EmbeddingTag,
  FreeTag,
  ReasoningTag,
  RerankerTag,
  ToolsCallingTag,
  VisionTag,
  WebSearchTag
} from './Tags/Model'

interface ModelTagsProps {
  model: Model
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
  size = 12,
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

    if (currentElement) {
      resizeObserver.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width } = entry.contentRect
          setShouldShowLabel(width >= maxWidth)
        }
      })
      resizeObserver.current.observe(currentElement)
    }
    return () => {
      if (resizeObserver.current && currentElement) {
        resizeObserver.current.unobserve(currentElement)
        resizeObserver.current.disconnect()
        resizeObserver.current = null
      }
    }
  }, [maxWidth, showLabel])

  return (
    <Container ref={containerRef} style={style}>
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
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  overflow-x: scroll;
  &::-webkit-scrollbar {
    display: none;
  }
`

export default memo(ModelTagsWithLabel)
