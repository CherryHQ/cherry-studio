import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import type { FC } from 'react'
import React from 'react'

import { CopyButtonContainer, KnowledgeItemMetadata } from './components'
import { useHighlightText } from './hooks'
interface Props {
  item: KnowledgeSearchResult & {
    file: FileMetadata | null
  }
  searchKeyword: string
}

const TextItem: FC<Props> = ({ item, searchKeyword }) => {
  const { highlightText } = useHighlightText()
  return (
    <>
      <KnowledgeItemMetadata item={item} />
      <CopyButtonContainer textToCopy={item.pageContent} />
      <p className="mb-0 select-text">{highlightText(item.pageContent, searchKeyword)}</p>
    </>
  )
}

export default React.memo(TextItem)
