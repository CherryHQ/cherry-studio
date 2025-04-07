import { EyeOutlined, GlobalOutlined, ToolOutlined } from '@ant-design/icons'
import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import { Model } from '@renderer/types'
import { isFreeModel } from '@renderer/utils'
import { FC } from 'react'
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
}

const ModelTagsWithLabel: FC<ModelTagsProps> = ({
  model,
  showFree = true,
  showReasoning = true,
  showToolsCalling = true,
  size = 12,
  showLabel = true
}) => {
  const { t } = useTranslation()
  return (
    <Container>
      {isVisionModel(model) && (
        <CustomTag size={size} color="#00b96b" icon={<EyeOutlined />}>
          {showLabel ? t('models.type.vision') : ''}
        </CustomTag>
      )}
      {isWebSearchModel(model) && (
        <CustomTag size={size} color="#1677ff" icon={<GlobalOutlined />}>
          {showLabel ? t('models.type.websearch') : ''}
        </CustomTag>
      )}
      {showReasoning && isReasoningModel(model) && (
        <CustomTag size={size} color="#6372bd" icon={<i className="iconfont icon-thinking" />}>
          {showLabel ? t('models.type.reasoning') : ''}
        </CustomTag>
      )}
      {showToolsCalling && isFunctionCallingModel(model) && (
        <CustomTag size={size} color="#d45ea3" icon={<ToolOutlined />}>
          {showLabel ? t('models.function_calling') : ''}
        </CustomTag>
      )}
      {isEmbeddingModel(model) && (
        <CustomTag size={size} color="#FFA500">
          {showLabel ? t('models.type.embedding') : ''}
        </CustomTag>
      )}
      {showFree && isFreeModel(model) && (
        <CustomTag size={size} color="#7cb305">
          {showLabel ? t('models.type.free') : ''}
        </CustomTag>
      )}
      {isRerankModel(model) && (
        <CustomTag size={size} color="#6495ED">
          {showLabel ? t('models.type.rerank') : ''}
        </CustomTag>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
`

export default ModelTagsWithLabel
