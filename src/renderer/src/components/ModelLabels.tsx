import { Tag } from 'antd'
import React, { useCallback } from 'react'
import styled from 'styled-components'

import { Model } from '../types'
import { useAllProviders } from '../hooks/useProvider'

interface ModelLabelsProps {
  model: Model
  parentContainer?: 'ModelIdWithTags' | 'ModelSelector' | 'SelectModelPopup' | 'MentionModelsButton' | 'default'
}

const ModelLabels: React.FC<ModelLabelsProps> = ({ model, parentContainer = 'default' }) => {
  const providers = useAllProviders()
  
  const handleApiKeyClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (model.apiKeyLink) {
        window.open(model.apiKeyLink, '_blank')
      }
    },
    [model.apiKeyLink]
  )

  // 检查智谱AI供应商是否配置了API key
  const shouldShowApiKeyTag = useCallback(() => {
    if (!model.apiKeyLink) return false
    
    // 如果是智谱AI的模型，检查是否配置了API key
    if (model.provider === 'zhipu') {
      const zhipuProvider = providers.find(p => p.id === 'zhipu')
      if (zhipuProvider && zhipuProvider.apiKey && zhipuProvider.apiKey.trim() !== '') {
        return false // 如果配置了API key，不显示标签
      }
    }
    
    return true
  }, [model.apiKeyLink, model.provider, providers])

  return (
    <LabelsContainer $parentContainer={parentContainer}>
      {model.isFree && (
        <Tag color="green" style={{ margin: 0, fontSize: '10px', lineHeight: '16px', color: '#00AD74' }}>
          free
        </Tag>
      )}
      {shouldShowApiKeyTag() && parentContainer !== 'ModelIdWithTags' && (
        <Tag
          color="orange"
          style={{ margin: 0, fontSize: '10px', lineHeight: '16px', cursor: 'pointer', color: '#FF7E29' }}
          onClick={handleApiKeyClick}>
          API Key ↗
        </Tag>
      )}
    </LabelsContainer>
  )
}

const LabelsContainer = styled.div<{
  $parentContainer: 'ModelIdWithTags' | 'ModelSelector' | 'SelectModelPopup' | 'MentionModelsButton' | 'default'
}>`
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: ${(props) =>
    props.$parentContainer === 'ModelIdWithTags' ||
    props.$parentContainer === 'ModelSelector' ||
    props.$parentContainer === 'SelectModelPopup' ||
    props.$parentContainer === 'MentionModelsButton'
      ? '0px'
      : '8px'};
`

export default ModelLabels
