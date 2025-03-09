import {
  isEmbeddingModel,
  isReasoningModel,
  isToolCallingModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import { Model } from '@renderer/types'
import { isFreeModel } from '@renderer/utils'
import { Tag } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ReasoningIcon from './Icons/ReasoningIcon'
import ToolsCallingIcon from './Icons/ToolsCallingIcon'
import VisionIcon from './Icons/VisionIcon'
import WebSearchIcon from './Icons/WebSearchIcon'

interface ModelTagsProps {
  model: Model
  showFree?: boolean
  showReasoning?: boolean
  showToolsCalling?: boolean
}

const ModelTags: FC<ModelTagsProps> = ({ model, showFree = true, showReasoning = true, showToolsCalling = true }) => {
  const { t } = useTranslation()
  return (
    <Container>
      {isVisionModel(model) && <VisionIcon />}
      {isWebSearchModel(model) && <WebSearchIcon />}
      {showReasoning && isReasoningModel(model) && <ReasoningIcon />}
      {showToolsCalling && isToolCallingModel(model) && <ToolsCallingIcon />}
      {isEmbeddingModel(model) && <Tag color="orange">{t('models.embedding')}</Tag>}
      {showFree && isFreeModel(model) && <Tag color="green">{t('models.free')}</Tag>}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
`

export default ModelTags
