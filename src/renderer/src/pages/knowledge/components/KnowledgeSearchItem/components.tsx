import { CopyOutlined } from '@ant-design/icons'
import { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import { Tooltip, Typography } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton, MetadataContainer, ScoreTag, TagContainer } from '.'
import { useCopyText, useKnowledgeItemMetadata } from './hooks'

const { Text } = Typography

interface KnowledgeItemMetadataProps {
  item: KnowledgeSearchResult & {
    file: FileMetadata | null
  }
}

export const KnowledgeItemMetadata: React.FC<KnowledgeItemMetadataProps> = ({ item }) => {
  const { getSourceLink } = useKnowledgeItemMetadata()
  const { t } = useTranslation()

  const sourceLink = getSourceLink(item)

  return (
    <MetadataContainer>
      <Text type="secondary">
        {t('knowledge.source')}:{' '}
        <a href={sourceLink.href} target="_blank" rel="noreferrer">
          {sourceLink.text}
        </a>
      </Text>
      {item.score !== 0 && <ScoreTag>Score: {(item.score * 100).toFixed(1)}%</ScoreTag>}
    </MetadataContainer>
  )
}

interface CopyButtonContainerProps {
  textToCopy: string
  tooltipTitle?: string
}

export const CopyButtonContainer: React.FC<CopyButtonContainerProps> = ({ textToCopy, tooltipTitle = 'Copy' }) => {
  const { handleCopy } = useCopyText()

  return (
    <TagContainer>
      <Tooltip title={tooltipTitle}>
        <CopyButton onClick={() => handleCopy(textToCopy)}>
          <CopyOutlined />
        </CopyButton>
      </Tooltip>
    </TagContainer>
  )
}
