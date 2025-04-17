import { isOpenAIWebSearch } from '@renderer/config/models'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Model } from '@renderer/types'
import type { CitationMessageBlock, MainTextMessageBlock, Message } from '@renderer/types/newMessageTypes'
import { Flex } from 'antd'
import React, { useMemo } from 'react'
import styled from 'styled-components'

import Markdown from '../../Markdown/Markdown'

// HTML实体编码辅助函数
const encodeHTML = (str: string): string => {
  const entities: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  }
  return str.replace(/[&<>"']/g, (match) => entities[match])
}

interface Props {
  block: MainTextMessageBlock
  citationsBlock?: CitationMessageBlock
  model?: Model
  mentions?: Model[]
  message: Message
}

const MainTextBlock: React.FC<Props> = ({
  block,
  citationsBlock,
  model,
  message,
  // citationsData = new Map(),
  // formattedCitations = [],
  mentions = []
}) => {
  const formattedCitations = useMemo(() => {
    if (!citationsBlock?.citations?.length && !citationsBlock?.annotations?.length) return null

    let citations: any[] = []

    if (model && isOpenAIWebSearch(model)) {
      citations =
        citationsBlock?.metadata?.annotations?.map((url, index) => {
          return { number: index + 1, url: url.url_citation?.url, hostname: url.url_citation.title }
        }) || []
    } else {
      citations =
        citationsBlock?.metadata?.citations?.map((url, index) => {
          try {
            const hostname = new URL(url).hostname
            return { number: index + 1, url, hostname }
          } catch {
            return { number: index + 1, url, hostname: url }
          }
        }) || []
    }
    console.log('citations', citations)
    // Deduplicate by URL
    const urlSet = new Set()
    return citations
      .filter((citation) => {
        if (!citation.url || urlSet.has(citation.url)) return false
        urlSet.add(citation.url)
        return true
      })
      .map((citation, index) => ({
        ...citation,
        number: index + 1 // Renumber citations sequentially after deduplication
      }))
  }, [citationsBlock?.citations, citationsBlock?.annotations, model])

  // 获取引用数据
  const citationsData = useMemo(() => {
    const searchResults =
      citationsBlock?.metadata?.webSearch?.results ||
      citationsBlock?.metadata?.webSearchInfo ||
      citationsBlock?.metadata?.groundingMetadata?.groundingChunks?.map((chunk) => chunk?.web) ||
      citationsBlock?.metadata?.annotations?.map((annotation) => annotation.url_citation) ||
      []
    const citationsUrls = formattedCitations || []

    // 合并引用数据
    const data = new Map()

    // 添加webSearch结果
    searchResults.forEach((result) => {
      data.set(result.url || result.uri || result.link, {
        url: result.url || result.uri || result.link,
        title: result.title || result.hostname,
        content: result.content
      })
    })

    // 添加citations
    citationsUrls.forEach((result) => {
      if (!data.has(result.url)) {
        data.set(result.url, {
          url: result.url,
          title: result.title || result.hostname || undefined,
          content: result.content || undefined
        })
      }
    })

    return data
  }, [
    formattedCitations,
    citationsBlock?.metadata?.annotations,
    citationsBlock?.metadata?.groundingMetadata?.groundingChunks,
    citationsBlock?.metadata?.webSearch?.results,
    citationsBlock?.metadata?.webSearchInfo
  ])

  // Process content to make citation numbers clickable
  const processedContentForMarkdown = useMemo(() => {
    let content = block.content

    // Only attempt citation processing if we have citation data
    if (formattedCitations && formattedCitations.length > 0 && citationsData.size > 0) {
      const citationUrls = formattedCitations.map((c) => c.url)

      // Logic for Perplexity/OpenRouter style: [1], [2]
      if (model?.provider === 'openrouter') {
        content = content.replace(/\[(\d+)\](?!\()/g, (match, numStr) => {
          const num = parseInt(numStr, 10)
          const index = num - 1
          if (index >= 0 && index < citationUrls.length) {
            const url = citationUrls[index]
            const citationInfo = url ? citationsData.get(url) || { url } : null
            const citationJson = url ? encodeHTML(JSON.stringify(citationInfo)) : null
            return `[<sup data-citation='${citationJson}'>${num}</sup>](${url})`
          }
          return match
        })
      } else {
        // Generic logic for [[1]], [1], [^1], [<sup>1</sup>](link)
        // Handle existing markdown links first
        content = content.replace(/\[<sup>(\d+)<\/sup>\]\(([^)]+)\)/g, (_, num, url) => {
          const citationInfo = url ? citationsData.get(url) || { url } : null
          const citationJson = citationInfo ? encodeHTML(JSON.stringify(citationInfo)) : null
          return `[<sup data-citation='${citationJson}'>${num}</sup>](${url})`
        })
        // Handle [[1]] or [1] or [^1]
        content = content.replace(/\*?\[(\^)?\[(\d+)\]\*?\]/g, (match, caret, numStr) => {
          const num = parseInt(numStr, 10)
          const index = num - 1
          if (index >= 0 && index < citationUrls.length) {
            const url = citationUrls[index]
            const citationInfo = url ? citationsData.get(url) || { url } : null
            const citationJson = citationInfo ? encodeHTML(JSON.stringify(citationInfo)) : null
            return `[<sup data-citation='${citationJson}'>${num}</sup>](${url})`
          }
          // Fallback for simple bracket numbers if no URL found
          return `[${numStr}]`
        })
      }
    }

    const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g
    content = content.replace(toolUseRegex, '')

    return content
  }, [block.content, formattedCitations, citationsData, model])

  return (
    <>
      {/* Render mentions associated with the message */}
      {mentions && mentions.length > 0 && (
        <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
          {mentions.map((m) => (
            <MentionTag key={getModelUniqId(m)}>{'@' + m.name}</MentionTag>
          ))}
        </Flex>
      )}
      <Markdown message={{ ...message, content: processedContentForMarkdown } as Message & { content: string }} />
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

export default React.memo(MainTextBlock)
