import type { WebSearchMessageBlock } from '@renderer/types/newMessageTypes'
import React, { useMemo } from 'react'

import CitationsList from '../CitationsList'

interface Props {
  block: WebSearchMessageBlock
  citationsData?: Map<string, { url: string; title?: string; content?: string }>
}

const WebSearchBlock: React.FC<Props> = ({ block, citationsData = new Map() }) => {
  // 格式化网页搜索结果
  const formattedResults = useMemo(() => {
    if (!block.results || block.results.length === 0) {
      return []
    }
    return block.results.map((result, index) => ({
      number: index + 1,
      url: result.url,
      title: result.title,
      showFavicon: true
    }))
  }, [block.results])

  if (formattedResults.length === 0) {
    return null
  }

  return <CitationsList citations={formattedResults} citationsData={citationsData} isWebSearch={true} />
}

export default React.memo(WebSearchBlock)