import { EyeOutlined, GlobalOutlined, ToolOutlined } from '@ant-design/icons'
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
import { isFreeModel } from '@renderer/utils'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import CustomTag from './CustomTag'

interface ModelTagsProps {
  model: Model
  showFree?: boolean
  showReasoning?: boolean
  showToolsCalling?: boolean
  size?: number
  showLabel?: boolean
  style?: React.CSSProperties
}

const ModelTagsWithLabel: FC<ModelTagsProps> = ({
  model,
  showFree = true,
  showReasoning = true,
  showToolsCalling = true,
  size = 12,
  showLabel = true,
  style
}) => {
  const { t } = useTranslation()
  const [_showLabel, _setShowLabel] = useState(showLabel)
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeObserver = useRef<ResizeObserver>(null)

  useEffect(() => {
    if (!showLabel) return

    if (containerRef.current) {
      const currentElement = containerRef.current
      resizeObserver.current = new ResizeObserver((entries) => {
        const maxWidth = i18n.language.startsWith('zh') ? 300 : 350

        for (const entry of entries) {
          const { width } = entry.contentRect
          _setShowLabel(width >= maxWidth)
        }
      })
      resizeObserver.current.observe(currentElement)

      return () => {
        if (resizeObserver.current) {
          resizeObserver.current.unobserve(currentElement)
        }
      }
    }

    return undefined
  }, [showLabel])

  return (
    <Container ref={containerRef} style={style}>
      {isVisionModel(model) && (
        <CustomTag
          size={size}
          color="#00b96b"
          icon={<EyeOutlined style={{ fontSize: size }} />}
          tooltip={t('models.type.vision')}>
          {_showLabel ? t('models.type.vision') : ''}
        </CustomTag>
      )}
      {isWebSearchModel(model) && (
        <CustomTag
          size={size}
          color="#1677ff"
          icon={<GlobalOutlined style={{ fontSize: size }} />}
          tooltip={t('models.type.websearch')}>
          {_showLabel ? t('models.type.websearch') : ''}
        </CustomTag>
      )}
      {showReasoning && isReasoningModel(model) && (
        <CustomTag
          size={size}
          color="#6372bd"
          icon={<i className="iconfont icon-thinking" />}
          tooltip={t('models.type.reasoning')}>
          {_showLabel ? t('models.type.reasoning') : ''}
        </CustomTag>
      )}
      {showToolsCalling && isFunctionCallingModel(model) && (
        <CustomTag
          size={size}
          color="#f18737"
          icon={<ToolOutlined style={{ fontSize: size }} />}
          tooltip={t('models.type.function_calling')}>
          {_showLabel ? t('models.type.function_calling') : ''}
        </CustomTag>
      )}
      {isEmbeddingModel(model) && (
        <CustomTag size={size} color="#FFA500" icon={t('models.type.embedding')} tooltip={t('models.type.embedding')} />
      )}
      {showFree && isFreeModel(model) && (
        <CustomTag size={size} color="#7cb305" icon={t('models.type.free')} tooltip={t('models.type.free')} />
      )}
      {isRerankModel(model) && (
        <CustomTag size={size} color="#6495ED" icon={t('models.type.rerank')} tooltip={t('models.type.rerank')} />
      )}
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

export default ModelTagsWithLabel
