import { SyncOutlined } from '@ant-design/icons'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Message, Model } from '@renderer/types'
import { getBriefInfo } from '@renderer/utils'
import { formatCitations, withMessageThought } from '@renderer/utils/formats'
import { encodeHTML } from '@renderer/utils/markdown'
import { Flex } from 'antd'
import { clone } from 'lodash'
import { Search } from 'lucide-react'
import React, { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BarLoader from 'react-spinners/BarLoader'
import styled, { css } from 'styled-components'

import Markdown from '../Markdown/Markdown'
import MessageAttachments from './MessageAttachments'
import MessageCitations from './MessageCitations'
import MessageError from './MessageError'
import MessageImage from './MessageImage'
import MessageThought from './MessageThought'
import MessageTools from './MessageTools'
import MessageTranslate from './MessageTranslate'

interface Props {
  readonly message: Readonly<Message>
  readonly model?: Readonly<Model>
}

const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g

const MessageContent: React.FC<Props> = ({ message: _message, model }) => {
  const { t } = useTranslation()
  let message = withMessageThought(clone(_message))

  // Memoize message status checks
  const messageStatus = useMemo(
    () => ({
      isSending: message.status === 'sending',
      isSearching: message.status === 'searching',
      isError: message.status === 'error',
      isMention: message.type === '@'
    }),
    [message.status, message.type]
  )

  // Memoize mentions rendering data
  const mentionsData = useMemo(() => {
    if (!message.mentions?.length) return null
    return message.mentions.map((model) => ({
      key: getModelUniqId(model),
      name: model.name
    }))
  }, [message.mentions])

  // 预先缓存 URL 对象，避免重复创建
  const urlCache = useMemo(() => new Map<string, URL>(), [])

  // Format citations for display
  const formattedCitations = useMemo(
    () => formatCitations(message.metadata, model, urlCache),
    [message.metadata, model, urlCache]
  )

  // 获取引用数据
  // https://github.com/CherryHQ/cherry-studio/issues/5234#issuecomment-2824704499
  const citationsData = useMemo(() => {
    const citationUrls =
      Array.isArray(message.metadata?.citations) &&
      (message?.metadata?.annotations?.map((annotation) => annotation.url_citation) ?? [])
    const searchResults =
      message?.metadata?.webSearch?.results ||
      message?.metadata?.webSearchInfo ||
      message?.metadata?.groundingMetadata?.groundingChunks?.map((chunk) => chunk?.web) ||
      citationUrls ||
      []

    // 使用对象而不是 Map 来提高性能
    const data = {}

    // 批量处理 webSearch 结果
    searchResults.forEach((result) => {
      const url = result.url || result.uri || result.link
      if (url && !data[url]) {
        data[url] = {
          url,
          title: result.title || result.hostname,
          content: result.content
        }
      }
    })

    // 批量处理 knowledge 结果
    message.metadata?.knowledge?.forEach((result) => {
      const { sourceUrl } = result
      if (sourceUrl && !data[sourceUrl]) {
        data[sourceUrl] = {
          url: sourceUrl,
          title: result.id,
          content: result.content
        }
      }
    })

    // 批量处理 citations
    formattedCitations?.forEach((result) => {
      const { url } = result
      if (url && !data[url]) {
        data[url] = {
          url,
          title: result.title || result.hostname,
          content: result.content
        }
      }
    })

    return data
  }, [
    formattedCitations,
    message.metadata?.annotations,
    message.metadata?.groundingMetadata?.groundingChunks,
    message.metadata?.knowledge,
    message.metadata?.webSearch?.results,
    message.metadata?.webSearchInfo
  ])

  /**
   * 知识库索引部分：解决LLM回复中未使用的知识库引用索引问题
   */
  // Process content to make citation numbers clickable
  const processedContent = useMemo(() => {
    const metadataFields = ['citations', 'webSearch', 'webSearchInfo', 'annotations', 'knowledge']
    const hasMetadata = metadataFields.some((field) => message.metadata?.[field])
    let content = message.content.replace(toolUseRegex, '')

    if (!hasMetadata) {
      return content
    }

    // 预先计算citations数组
    const websearchResults = message?.metadata?.webSearch?.results?.map((result) => result.url) || []
    const knowledgeResults = message?.metadata?.knowledge?.map((result) => result.sourceUrl) || []
    const citations = message?.metadata?.citations || [...websearchResults, ...knowledgeResults]
    const webSearchLength = websearchResults.length // 计算 web search 结果的数量

    if (message.metadata?.webSearch || message.metadata?.knowledge) {
      const usedOriginalIndexes: number[] = []
      const citationRegex = /\[\[(\d+)\]\]|\[(\d+)\]/g

      // 第一步: 识别有效的原始索引
      for (const match of content.matchAll(citationRegex)) {
        const numStr = match[1] || match[2]
        const index = parseInt(numStr) - 1
        if (index >= webSearchLength && index < citations.length && citations[index]) {
          if (!usedOriginalIndexes.includes(index)) {
            usedOriginalIndexes.push(index)
          }
        }
      }
      // 对使用的原始索引进行排序，以便后续查找新索引
      usedOriginalIndexes.sort((a, b) => a - b)

      // 创建原始索引到新索引的映射
      const originalIndexToNewIndexMap = new Map<number, number>()
      usedOriginalIndexes.forEach((originalIndex, newIndex) => {
        originalIndexToNewIndexMap.set(originalIndex, newIndex)
      })

      // 第二步: 替换并使用新的索引编号
      content = content.replace(citationRegex, (match, num1, num2) => {
        const numStr = num1 || num2
        const originalIndex = parseInt(numStr) - 1

        // 检查索引是否有效
        if (originalIndex < 0 || originalIndex >= citations.length || !citations[originalIndex]) {
          return match // 无效索引，返回原文
        }

        const link = citations[originalIndex]
        const citation = { ...(citationsData[link] || { url: link }) }
        if (citation.content) {
          citation.content = citation.content.substring(0, 200)
        }
        const citationDataHtml = encodeHTML(JSON.stringify(citation))

        // 检查是否是 *被使用的知识库* 引用
        if (originalIndexToNewIndexMap.has(originalIndex)) {
          const newIndex = originalIndexToNewIndexMap.get(originalIndex)!
          const newCitationNum = webSearchLength + newIndex + 1 // 重新编号的知识库引用 (从websearch index+1开始)

          const isWebLink = link.startsWith('http://') || link.startsWith('https://')
          if (!isWebLink) {
            // 知识库引用通常不是网页链接，只显示上标数字
            return `<sup>${newCitationNum}</sup>`
          } else {
            // 如果知识库源是网页链接 (特殊情况)
            return `[<sup data-citation='${citationDataHtml}'>${newCitationNum}</sup>](${link})`
          }
        }
        // 检查是否是 *Web搜索* 引用
        else if (originalIndex < webSearchLength) {
          const citationNum = originalIndex + 1 // Web搜索引用保持原编号 (从1开始)
          return `[<sup data-citation='${citationDataHtml}'>${citationNum}</sup>](${link})`
        }
        // 其他情况 (如未使用的知识库引用)，返回原文
        else {
          return match
        }
      })

      // 过滤掉未使用的知识索引
      message = {
        ...message,
        metadata: {
          ...message.metadata,
          // 根据其对应的全局索引是否存在于 usedOriginalIndexes 来过滤
          knowledge: message.metadata.knowledge?.filter((_, knowledgeIndex) =>
            usedOriginalIndexes.includes(knowledgeIndex + webSearchLength)
          )
        }
      }
    } else {
      // 处理非 webSearch/knowledge 的情况 (这部分逻辑保持不变)
      const citationRegex = /\[<sup>(\d+)<\/sup>\]\(([^)]+)\)/g
      content = content.replace(citationRegex, (_, num, url) => {
        const citation = citationsData[url] || { url }
        const citationData = url ? encodeHTML(JSON.stringify(citation)) : null
        return `[<sup data-citation='${citationData}'>${num}</sup>](${url})`
      })
    }

    return content
  }, [message.content, message.metadata, citationsData])

  if (messageStatus.isSending) {
    return (
      <MessageContentLoading>
        <SyncOutlined spin size={24} />
      </MessageContentLoading>
    )
  }

  if (messageStatus.isSearching) {
    return (
      <SearchingContainer>
        <Search size={24} />
        <SearchingText>{t('message.searching')}</SearchingText>
        <BarLoader color="#1677ff" />
      </SearchingContainer>
    )
  }

  if (messageStatus.isError) {
    return <MessageError message={message} />
  }

  if (messageStatus.isMention && model) {
    const content = `[@${model.name}](#)  ${getBriefInfo(message.content)}`
    return <Markdown message={{ ...message, content }} />
  }

  return (
    <Fragment>
      {mentionsData && (
        <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
          {mentionsData.map(({ key, name }) => (
            <MentionTag key={key}>{'@' + name}</MentionTag>
          ))}
        </Flex>
      )}
      <MessageThought message={message} />
      <MessageTools message={message} />
      <Markdown message={{ ...message, content: processedContent }} />
      <MessageImage message={message} />
      <MessageTranslate message={message} />
      <MessageCitations message={message} formattedCitations={formattedCitations} model={model} />
      <MessageAttachments message={message} />
    </Fragment>
  )
}

const MessageContentLoading = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 32px;
  margin-top: -5px;
  margin-bottom: 5px;
`

const baseContainer = css`
  display: flex;
  flex-direction: row;
  align-items: center;
`

const SearchingContainer = styled.div`
  ${baseContainer}
  background-color: var(--color-background-mute);
  padding: 10px;
  border-radius: 10px;
  margin-bottom: 10px;
  gap: 10px;
`

const MentionTag = styled.span`
  color: var(--color-link);
`

const SearchingText = styled.div`
  font-size: 14px;
  line-height: 1.6;
  text-decoration: none;
  color: var(--color-text-1);
`

export default React.memo(MessageContent)
