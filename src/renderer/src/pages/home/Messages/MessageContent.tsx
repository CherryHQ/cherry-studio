import { InfoCircleOutlined, SyncOutlined, TranslationOutlined } from '@ant-design/icons'
import { Message, Model } from '@renderer/types'
import { getBriefInfo } from '@renderer/utils'
import { withMessageThought } from '@renderer/utils/formats'
import { Divider, Flex } from 'antd'
import React, { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import Markdown from '../Markdown/Markdown'
import MessageAttachments from './MessageAttachments'
import MessageError from './MessageError'
import MessageSearchResults from './MessageSearchResults'
import MessageThought from './MessageThought'

interface Props {
  message: Message
  model?: Model
}

const MessageContent: React.FC<Props> = ({ message: _message, model }) => {
  const { t } = useTranslation()
  const message = withMessageThought(_message)

  // Process content to make citation numbers clickable
  const processedContent = useMemo(() => {
    if (!message.content || !message.metadata?.citations) return message.content

    let content = message.content
    const citations = message.metadata.citations

    // Convert [n] format to superscript numbers and make them clickable
    content = content.replace(/\[(\d+)\]/g, (match, num) => {
      const index = parseInt(num) - 1
      if (index >= 0 && index < citations.length) {
        // Use <sup> tag for superscript and make it a link
        return `[<sup>${num}</sup>](${citations[index]})`
      }
      return match
    })

    return content
  }, [message.content, message.metadata?.citations])

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
        {message.mentions?.map((model) => <MentionTag key={model.id}>{'@' + model.name}</MentionTag>)}
      </Flex>
      <MessageThought message={message} />
      <Markdown message={{ ...message, content: processedContent }} />
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
      <MessageAttachments message={message} />
      <MessageSearchResults message={message} />
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

export default React.memo(MessageContent)
