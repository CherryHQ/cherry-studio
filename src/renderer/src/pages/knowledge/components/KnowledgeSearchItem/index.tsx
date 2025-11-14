import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import React from 'react'
import styled from 'styled-components'

import TextItem from './TextItem'
import VideoItem from './VideoItem'

// Export shared components
export { CopyButtonContainer, KnowledgeItemMetadata } from './components'
export { useCopyText, useHighlightText, useKnowledgeItemMetadata } from './hooks'

interface Props {
  item: KnowledgeSearchResult & {
    file: FileMetadata | null
  }
  searchKeyword: string
}
const SearchItemRenderer: React.FC<Props> = ({ item, searchKeyword }) => {
  const renderItem = () => {
    if (item.metadata.type === 'video') {
      return <VideoItem item={item} searchKeyword={searchKeyword} />
    } else {
      return <TextItem item={item} searchKeyword={searchKeyword} />
    }
  }

  return <ResultItem>{renderItem()}</ResultItem>
}

export default React.memo(SearchItemRenderer)

export const TagContainer = styled.div`
  position: absolute;
  top: 58px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
`

const ResultItem = styled.div`
  width: 100%;
  position: relative;
  padding: 16px;
  background: var(--color-background-soft);
  border-radius: 8px;

  &:hover {
    ${TagContainer} {
      opacity: 1 !important;
    }
  }
`

export const ScoreTag = styled.div`
  padding: 2px 8px;
  background: var(--color-primary);
  color: white;
  border-radius: 4px;
  font-size: 12px;
  flex-shrink: 0;
`

export const CopyButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: var(--color-background-mute);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--color-primary);
    color: white;
  }
`

export const MetadataContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
  user-select: text;
`
