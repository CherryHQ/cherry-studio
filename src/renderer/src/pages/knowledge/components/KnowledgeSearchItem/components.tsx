import { Tooltip } from '@cherrystudio/ui'
import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import { Copy } from 'lucide-react'
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
      <span className="text-muted-foreground text-sm">
        {t('knowledge.source')}:{' '}
        <a href={sourceLink.href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {sourceLink.text}
        </a>
      </span>
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
      <Tooltip content={tooltipTitle}>
        <CopyButton onClick={() => handleCopy(textToCopy)}>
          <Copy size={14} />
        </CopyButton>
      </Tooltip>
    </TagContainer>
  )
}
