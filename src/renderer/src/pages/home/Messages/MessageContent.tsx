import { SyncOutlined } from '@ant-design/icons'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import type { Message } from '@renderer/types/newMessageTypes'
import { withMessageThought } from '@renderer/utils/formats'
import { Flex } from 'antd'
import { clone } from 'lodash'
import { Search } from 'lucide-react'
import React, { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import BarLoader from 'react-spinners/BarLoader'
import styled from 'styled-components'

import MessageBlockRenderer from './Blocks'
import MessageError from './MessageError'
interface Props {
  message: Message
  model?: Model
}

const MessageContent: React.FC<Props> = ({ message: _message, model }) => {
  const { t } = useTranslation()
  const message = withMessageThought(clone(_message))

  // Format citations for display
  // const formattedCitations = useMemo(() => {
  //   if (!message.metadata?.citations?.length && !message.metadata?.annotations?.length) return null

  //   let citations: any[] = []

  //   if (model && isOpenAIWebSearch(model)) {
  //     citations =
  //       message.metadata.annotations?.map((url, index) => {
  //         return { number: index + 1, url: url.url_citation?.url, hostname: url.url_citation.title }
  //       }) || []
  //   } else {
  //     citations =
  //       message.metadata?.citations?.map((url, index) => {
  //         try {
  //           const hostname = new URL(url).hostname
  //           return { number: index + 1, url, hostname }
  //         } catch {
  //           return { number: index + 1, url, hostname: url }
  //         }
  //       }) || []
  //   }

  //   // Deduplicate by URL
  //   const urlSet = new Set()
  //   return citations
  //     .filter((citation) => {
  //       if (!citation.url || urlSet.has(citation.url)) return false
  //       urlSet.add(citation.url)
  //       return true
  //     })
  //     .map((citation, index) => ({
  //       ...citation,
  //       number: index + 1 // Renumber citations sequentially after deduplication
  //     }))
  // }, [message.metadata?.citations, message.metadata?.annotations, model])

  // 判断是否有引用内容
  // 挪到 CitationBlock 组件中
  // const hasCitations = useMemo(() => {
  //   return !!(
  //     (formattedCitations && formattedCitations.length > 0) ||
  //     (message?.metadata?.webSearch && message.status === 'success') ||
  //     (message?.metadata?.webSearchInfo && message.status === 'success') ||
  //     (message?.metadata?.groundingMetadata && message.status === 'success')
  //   )
  // }, [formattedCitations, message])

  // 获取引用数据
  // const citationsData = useMemo(() => {
  //   const searchResults =
  //     message?.metadata?.webSearch?.results ||
  //     message?.metadata?.webSearchInfo ||
  //     message?.metadata?.groundingMetadata?.groundingChunks?.map((chunk) => chunk?.web) ||
  //     message?.metadata?.annotations?.map((annotation) => annotation.url_citation) ||
  //     []
  //   const citationsUrls = formattedCitations || []

  //   // 合并引用数据
  //   const data = new Map()

  //   // 添加webSearch结果
  //   searchResults.forEach((result) => {
  //     data.set(result.url || result.uri || result.link, {
  //       url: result.url || result.uri || result.link,
  //       title: result.title || result.hostname,
  //       content: result.content
  //     })
  //   })

  //   // 添加citations
  //   citationsUrls.forEach((result) => {
  //     if (!data.has(result.url)) {
  //       data.set(result.url, {
  //         url: result.url,
  //         title: result.title || result.hostname || undefined,
  //         content: result.content || undefined
  //       })
  //     }
  //   })

  //   return data
  // }, [
  //   formattedCitations,
  //   message?.metadata?.annotations,
  //   message?.metadata?.groundingMetadata?.groundingChunks,
  //   message?.metadata?.webSearch?.results,
  //   message?.metadata?.webSearchInfo
  // ])

  // // Process content to make citation numbers clickable
  // const processedContent = useMemo(() => {
  //   if (
  //     !(
  //       message.metadata?.citations ||
  //       message.metadata?.webSearch ||
  //       message.metadata?.webSearchInfo ||
  //       message.metadata?.annotations
  //     )
  //   ) {
  //     return message.content
  //   }

  //   let content = message.content

  //   const searchResultsCitations = message?.metadata?.webSearch?.results?.map((result) => result.url) || []

  //   const citations = message?.metadata?.citations || searchResultsCitations

  //   // Convert [n] format to superscript numbers and make them clickable
  //   // Use <sup> tag for superscript and make it a link with citation data
  //   if (message.metadata?.webSearch) {
  //     content = content.replace(/\[\[(\d+)\]\]|\[(\d+)\]/g, (match, num1, num2) => {
  //       const num = num1 || num2
  //       const index = parseInt(num) - 1
  //       if (index >= 0 && index < citations.length) {
  //         const link = citations[index]
  //         const citationData = link ? encodeHTML(JSON.stringify(citationsData.get(link) || { url: link })) : null
  //         return link ? `[<sup data-citation='${citationData}'>${num}</sup>](${link})` : `<sup>${num}</sup>`
  //       }
  //       return match
  //     })
  //   } else {
  //     content = content.replace(/\[<sup>(\d+)<\/sup>\]\(([^)]+)\)/g, (_, num, url) => {
  //       const citationData = url ? encodeHTML(JSON.stringify(citationsData.get(url) || { url })) : null
  //       return `[<sup data-citation='${citationData}'>${num}</sup>](${url})`
  //     })
  //   }
  //   return content
  // }, [
  //   message.metadata?.citations,
  //   message.metadata?.webSearch,
  //   message.metadata?.webSearchInfo,
  //   message.metadata?.annotations,
  //   message.content,
  //   citationsData
  // ])

  if (message.status === 'sending') {
    return (
      <MessageContentLoading>
        <SyncOutlined spin size={24} />
      </MessageContentLoading>
    )
  }

  if (message.status === 'searching') {
    return (
      <SearchingContainer>
        <Search size={24} />
        <SearchingText>{t('message.searching')}</SearchingText>
        <BarLoader color="#1677ff" />
      </SearchingContainer>
    )
  }

  if (message.status === 'error') {
    return <MessageError message={message} />
  }

  // if (message.type === '@' && model) {
  //   const content = `[@${model.name}](#)  ${getBriefInfo(message.content)}`
  //   return <Markdown message={{ ...message, content }} />
  // }
  // const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g

  // console.log('message', message)

  return (
    <Fragment>
      <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
        {message.mentions?.map((model) => <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>)}
      </Flex>
      {/* <MessageThought message={message} /> */}
      {/* <MessageTools message={message} /> */}
      {/* <Markdown message={{ ...message, content: processedContent.replace(toolUseRegex, '') }} /> */}
      {/* {message.metadata?.generateImage && <MessageImage message={message} />} */}
      {/* {message.translatedContent && (
        <Fragment>
          <Divider style={{ margin: 0, marginBottom: 10 }}>
            <TranslationOutlined />
          </Divider>
          {message.translatedContent === t('translate.processing') ? (
            <BeatLoader color="var(--color-text-2)" size="10" style={{ marginBottom: 15 }} />
          ) : (
            <Markdown message={{ ...message, content: message.translatedContent }} />
          )}
        </Fragment>
      )} */}
      {/* <MessageAttachments message={message} /> // TODO 没想好放在哪 */}
      <MessageBlockRenderer blocks={message.blocks} model={model} message={message} />
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

const SearchingContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
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
