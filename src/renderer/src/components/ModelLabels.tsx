import { Tag } from 'antd'
import React, { useCallback } from 'react'
import styled from 'styled-components'

import { Model } from '../types'

interface ModelLabelsProps {
  model: Model
}

const ModelLabels: React.FC<ModelLabelsProps> = ({ model }) => {
  const handleApiKeyClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (model.apiKeyLink) {
      window.open(model.apiKeyLink, '_blank')
    }
  }, [model.apiKeyLink])

  return (
    <LabelsContainer>
      {model.isFree && (
        <Tag color="green" style={{ margin: 0, fontSize: '10px', lineHeight: '16px', color: '#00AD74' }}>
          free
        </Tag>
      )}
      {model.apiKeyLink && (
        <Tag 
          color="orange" 
          style={{ margin: 0, fontSize: '10px', lineHeight: '16px', cursor: 'pointer', color: '#FF7E29' }}
          onClick={handleApiKeyClick}
        >
          API Key ↗
        </Tag>
      )}
    </LabelsContainer>
  )
}

const LabelsContainer = styled.div`
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: 8px;
`

export default ModelLabels

