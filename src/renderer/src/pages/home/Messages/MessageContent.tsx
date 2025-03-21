import { InfoCircleOutlined, SearchOutlined, SyncOutlined, TranslationOutlined } from '@ant-design/icons'
import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { HStack } from '@renderer/components/Layout'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Message, Model } from '@renderer/types'
import { getBriefInfo } from '@renderer/utils'
import { withMessageThought } from '@renderer/utils/formats'
import { Divider, Flex } from 'antd'
import { clone } from 'lodash'
import React, { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BarLoader from 'react-spinners/BarLoader'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import Markdown from '../Markdown/Markdown'
import MessageAttachments from './MessageAttachments'
import MessageError from './MessageError'
import MessageSearchResults from './MessageSearchResults'
import MessageThought from './MessageThought'
import MessageTools from './MessageTools'

interface Props {
  message: Message
  model?: Model
}

const MessageContent: React.FC<Props> = ({ message: _message, model }) => {
  const { t } = useTranslation()
  const message = withMessageThought(clone(_message))

  // HTML实体编码辅助函数
  const encodeHTML = (str: string) => {
    return str.replace(/[&<>"']/g, (match) => {
      const entities: { [key: string]: string } = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;'
      }
      return entities[match]
    })
  }

  // 获取引用数据
  const citationsData = useMemo(() => {
    const searchResults = message?.metadata?.webSearch?.results || []
    const citationsUrls = message?.metadata?.citations || []

    // 合并引用数据
    const data = new Map()

    // 添加webSearch结果
    searchResults.forEach((result) => {
      data.set(result.url, {
        url: result.url,
        title: result.title,
        content: result.content
      })
    })

    // 添加citations
    citationsUrls.forEach((url) => {
      if (!data.has(url)) {
        data.set(url, {
          url: url
          // 如果没有title和content，将在CitationTooltip中显示hostname
        })
      }
    })

    return data
  }, [message.metadata?.citations, message.metadata?.webSearch?.results])

  // Process content to make citation numbers clickable
  const processedContent = useMemo(() => {
    if (!(message.metadata?.citations || message.metadata?.webSearch)) {
      return message.content
    }

    let content = message.content

    const searchResultsCitations = message?.metadata?.webSearch?.results?.map((result) => result.url) || []

    const citations = message?.metadata?.citations || searchResultsCitations

    // Convert [n] format to superscript numbers and make them clickable
    // Use <sup> tag for superscript and make it a link with citation data
    content = content.replace(/\[\[(\d+)\]\]|\[(\d+)\]/g, (match, num1, num2) => {
      const num = num1 || num2
      const index = parseInt(num) - 1
      if (index >= 0 && index < citations.length) {
        const link = citations[index]
        const citationData = link ? encodeHTML(JSON.stringify(citationsData.get(link) || { url: link })) : null
        return link ? `[<sup data-citation='${citationData}'>${num}</sup>](${link})` : `<sup>${num}</sup>`
      }
      return match
    })

    return content
  }, [message.content, message.metadata, citationsData])

  // Format citations for display
  const formattedCitations = useMemo(() => {
    if (!message.metadata?.citations?.length) return null

    return message.metadata.citations.map((url, index) => {
      try {
        const hostname = new URL(url).hostname
        return { number: index + 1, url, hostname }
      } catch {
        return { number: index + 1, url, hostname: url }
      }
    })
  }, [message.metadata?.citations])

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
        <SearchOutlined size={24} />
        <SearchingText>{t('message.searching')}</SearchingText>
        <BarLoader color="#1677ff" />
      </SearchingContainer>
    )
  }

  if (message.status === 'error') {
    return <MessageError message={message} />
  }

  if (message.type === '@' && model) {
    const content = `[@${model.name}](#)  ${getBriefInfo(message.content)}`
    return <Markdown message={{ ...message, content }} />
  }

  return (
    <Fragment>
      <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
        {message.mentions?.map((model) => <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>)}
      </Flex>
      <MessageThought message={message} />
      <MessageTools message={message} />
      <Markdown message={{ ...message, content: processedContent }} citationsData={citationsData} />
      {message.translatedContent && (
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
      )}
      <MessageSearchResults message={message} />
      {formattedCitations && (
        <CitationsContainer>
          <CitationsTitle>
            {t('message.citations')}
            <InfoCircleOutlined style={{ fontSize: '14px', marginLeft: '4px', opacity: 0.6 }} />
          </CitationsTitle>
          {formattedCitations.map(({ number, url, hostname }) => (
            <CitationLink key={number} href={url} target="_blank" rel="noopener noreferrer">
              {number}. <span className="hostname">{hostname}</span>
            </CitationLink>
          ))}
        </CitationsContainer>
      )}
      {message?.metadata?.webSearch && message.status === 'success' && (
        <CitationsContainer className="footnotes">
          <CitationsTitle>
            {t('message.citations')}
            <InfoCircleOutlined style={{ fontSize: '14px', marginLeft: '4px', opacity: 0.6 }} />
          </CitationsTitle>
          {message.metadata.webSearch.results.map((result, index) => (
            <HStack key={result.url} style={{ alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-2)' }}>{index + 1}.</span>
              <Favicon hostname={new URL(result.url).hostname} alt={result.title} />
              <CitationLink href={result.url} target="_blank" rel="noopener noreferrer">
                {result.title}
              </CitationLink>
            </HStack>
          ))}
        </CitationsContainer>
      )}
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

const CitationsContainer = styled.div`
  background-color: rgb(242, 247, 253);
  border-radius: 4px;
  padding: 8px 12px;
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;

  body[theme-mode='dark'] & {
    background-color: rgba(255, 255, 255, 0.05);
  }
`

const CitationsTitle = styled.div`
  font-weight: 500;
  margin-bottom: 4px;
  color: var(--color-text-1);
`

const CitationLink = styled.a`
  font-size: 14px;
  line-height: 1.6;
  text-decoration: none;
  color: var(--color-text-1);

  .hostname {
    color: var(--color-link);
  }

  &:hover {
    text-decoration: underline;
  }
`

const SearchingText = styled.div`
  font-size: 14px;
  line-height: 1.6;
  text-decoration: none;
  color: var(--color-text-1);
`

export default React.memo(MessageContent)
