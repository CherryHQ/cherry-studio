import { CopyIcon } from '@cherrystudio/ui'
import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton, MetadataContainer, ScoreTag, TagContainer } from '.'
import { useCopyText, useKnowledgeItemMetadata } from './hooks'

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
      <span style={{ color: 'var(--color-text-2)' }}>
        {t('knowledge.source')}:{' '}
        <a href={sourceLink.href} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>
          {sourceLink.text}
        </a>
      </span>
      {item.score !== 0 && <ScoreTag>Score: {(item.score * 100).toFixed(1)}%</ScoreTag>}
    </MetadataContainer>
  )
}

interface CopyButtonContainerProps {
  textToCopy: string
}

export const CopyButtonContainer: React.FC<CopyButtonContainerProps> = ({ textToCopy }) => {
  const { handleCopy } = useCopyText()

  return (
    <TagContainer>
      <CopyButton onClick={() => handleCopy(textToCopy)}>
        <CopyIcon />
      </CopyButton>
    </TagContainer>
  )
}
