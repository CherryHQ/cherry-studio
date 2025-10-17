import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import React from 'react'

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

  return <div className="group relative w-full rounded-lg bg-[var(--color-background-soft)] p-4">{renderItem()}</div>
}

export default React.memo(SearchItemRenderer)

export const TagContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="absolute top-[58px] right-4 flex items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
      {children}
    </div>
  )
}

export const ScoreTag: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="flex-shrink-0 rounded bg-[var(--color-primary)] px-2 py-0.5 text-white text-xs">{children}</div>
  )
}

export const CopyButton: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({ children, onClick }) => {
  return (
    <div
      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-[var(--color-background-mute)] text-[var(--color-text)] transition-all duration-200 hover:bg-[var(--color-primary)] hover:text-white"
      onClick={onClick}>
      {children}
    </div>
  )
}

export const MetadataContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="mb-2 flex select-text items-center justify-between gap-4 border-[var(--color-border)] border-b pb-2">
      {children}
    </div>
  )
}
