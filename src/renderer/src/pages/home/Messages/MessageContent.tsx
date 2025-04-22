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
  const message = withMessageThought(clone(_message))

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
  const citationsData = useMemo(() => {
    const searchResults =
      message?.metadata?.webSearch?.results ||
      message?.metadata?.webSearchInfo ||
      message?.metadata?.groundingMetadata?.groundingChunks?.map((chunk) => chunk?.web) ||
      message?.metadata?.annotations?.map((annotation) => annotation.url_citation) ||
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

  // Process content to make citation numbers clickable
  const processedContent = useMemo(() => {
    const metadataFields = ['citations', 'webSearch', 'webSearchInfo', 'annotations', 'knowledge']
    const hasMetadata = metadataFields.some((field) => message.metadata?.[field])

    if (!hasMetadata) {
      return message.content
    }

    let content = message.content

    // 预先计算citations数组，避免重复计算
    const websearchResults = message?.metadata?.webSearch?.results?.map((result) => result.url) || []
    const knowledgeResults = message?.metadata?.knowledge?.map((result) => result.sourceUrl) || []
    const citations = message?.metadata?.citations || [...websearchResults, ...knowledgeResults]

    // 优化正则表达式匹配
    if (message.metadata?.webSearch || message.metadata?.knowledge) {
      // 合并两个正则为一个，减少遍历次数
      content = content.replace(/\[\[(\d+)\]\]|\[(\d+)\]/g, (match, num1, num2) => {
        const num = num1 || num2
        const index = parseInt(num) - 1

        if (index < 0 || index >= citations.length) {
          return match
        }

        const link = citations[index]
        if (!link) {
          return match
        }

        const isWebLink = link.startsWith('http://') || link.startsWith('https://')
        if (!isWebLink) {
          return `<sup>${num}</sup>`
        }

        const citation = citationsData[link] || { url: link }
        if (citation.content) {
          citation.content = citation.content.substring(0, 200)
        }

        return `[<sup data-citation='${encodeHTML(JSON.stringify(citation))}'>${num}</sup>](${link})`
      })
    } else {
      // 使用预编译的正则表达式
      const citationRegex = /\[<sup>(\d+)<\/sup>\]\(([^)]+)\)/g
      content = content.replace(citationRegex, (_, num, url) => {
        const citation = citationsData[url] || { url }
        const citationData = url ? encodeHTML(JSON.stringify(citation)) : null
        return `[<sup data-citation='${citationData}'>${num}</sup>](${url})`
      })
    }

    return content.replace(toolUseRegex, '')
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
