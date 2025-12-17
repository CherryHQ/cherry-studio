import type { FileMetadata, KnowledgeSearchResult } from '@renderer/types'
import { Typography } from 'antd'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButtonContainer, KnowledgeItemMetadata } from './components'
import { useHighlightText } from './hooks'

const { Paragraph } = Typography
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
      <Paragraph style={{ userSelect: 'text', marginBottom: 0 }}>
        {highlightText(item.pageContent, searchKeyword)}
      </Paragraph>
    </>
  )
}

export default React.memo(TextItem)
