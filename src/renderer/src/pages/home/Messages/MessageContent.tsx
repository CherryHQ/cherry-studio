import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { Flex } from 'antd'
import React from 'react'
import styled from 'styled-components'

import MessageBlockRenderer from './Blocks'
interface Props {
  message: Message
  model?: Model
}

const MessageContent: React.FC<Props> = ({ message, model }) => {
  // const { t } = useTranslation()
  // if (message.status === 'pending') {
  //   return (

  //   )
  // }

  // if (message.status === 'searching') {
  //   return (
  //     <SearchingContainer>
  //       <Search size={24} />
  //       <SearchingText>{t('message.searching')}</SearchingText>
  //       <BarLoader color="#1677ff" />
  //     </SearchingContainer>
  //   )
  // }

  // if (message.status === 'error') {
  //   return <MessageError message={message} />
  // }

  // if (message.type === '@' && model) {
  //   const content = `[@${model.name}](#)  ${getBriefInfo(message.content)}`
  //   return <Markdown message={{ ...message, content }} />
  // }
  // const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g

  // console.log('message', message)

  return (
    <>
      <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
        {message.mentions?.map((model) => <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>)}
      </Flex>
      <MessageThought message={message} />
      <MessageTools message={message} />
      <Markdown message={{ ...message, content: processedContent.replace(toolUseRegex, '') }} />
      {message.metadata?.generateImage && <MessageImage message={message} />}
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
      {hasCitations && (
        <>
          {message?.metadata?.groundingMetadata && message.status === 'success' && (
            <SearchEntryPoint
              dangerouslySetInnerHTML={{
                __html: message.metadata.groundingMetadata?.searchEntryPoint?.renderedContent
                  ? message.metadata.groundingMetadata.searchEntryPoint.renderedContent
                      .replace(/@media \(prefers-color-scheme: light\)/g, 'body[theme-mode="light"]')
                      .replace(/@media \(prefers-color-scheme: dark\)/g, 'body[theme-mode="dark"]')
                  : ''
              }}
            />
          )}

          <CitationsList
            citationCount={
              (formattedCitations?.length || 0) +
              (message?.metadata?.webSearch?.results?.length || 0) +
              (message?.metadata?.knowledge?.length || 0) +
              (message?.metadata?.webSearchInfo?.length || 0) +
              (message?.metadata?.groundingMetadata?.groundingChunks?.length || 0)
            }
            citations={[
              ...(message?.metadata?.groundingMetadata?.groundingChunks?.map((chunk, index) => ({
                number: index + 1,
                url: chunk?.web?.uri || '',
                title: chunk?.web?.title,
                showFavicon: false
              })) || []),
              ...(formattedCitations?.map((citation) => ({
                number: citation.number,
                url: citation.url,
                hostname: citation.hostname,
                showFavicon: isWebCitation
              })) || []),
              ...(message?.metadata?.webSearch?.results?.map((result, index) => ({
                number: index + 1,
                url: result.url,
                title: result.title,
                showFavicon: true,
                type: 'websearch'
              })) || []),
              ...(message?.metadata?.knowledge?.map((result, index) => ({
                number: (message.metadata?.webSearch?.results?.length || 0) + index + 1,
                url: result.sourceUrl,
                title: result.sourceUrl,
                showFavicon: true,
                type: 'knowledge'
              })) || []),
              ...(message?.metadata?.webSearchInfo?.map((result, index) => ({
                number: index + 1,
                url: result.link || result.url,
                title: result.title,
                showFavicon: true
              })) || [])
            ].filter(Boolean)}
          />
        </>
      )}

      <MessageAttachments message={message} />
    </Fragment>
  )
}

// const SearchingContainer = styled.div`
//   display: flex;
//   flex-direction: row;
//   align-items: center;
//   background-color: var(--color-background-mute);
//   padding: 10px;
//   border-radius: 10px;
//   margin-bottom: 10px;
//   gap: 10px;
// `

const MentionTag = styled.span`
  color: var(--color-link);
`

// const SearchingText = styled.div`
//   font-size: 14px;
//   line-height: 1.6;
//   text-decoration: none;
//   color: var(--color-text-1);
// `

export default React.memo(MessageContent)
