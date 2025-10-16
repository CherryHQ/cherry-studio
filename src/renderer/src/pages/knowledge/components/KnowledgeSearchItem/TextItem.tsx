import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButtonContainer, KnowledgeItemMetadata } from './components'
import { useHighlightText } from './hooks'
interface Props {
  item: KnowledgeSearchResult & {
    file: FileMetadata | null
  }
  searchKeyword: string
}

const TextItem: FC<Props> = ({ item, searchKeyword }) => {
  const { t } = useTranslation()
  const { highlightText } = useHighlightText()
  return (
    <>
      <KnowledgeItemMetadata item={item} />
      <CopyButtonContainer textToCopy={item.pageContent} tooltipTitle={t('common.copy')} />
      <p className="mb-0 select-text">
        {highlightText(item.pageContent, searchKeyword)}
      </p>
    </>
  )
}

export default React.memo(TextItem)
