import { isOpenAIWebSearch } from '@renderer/config/models'
import { Message, Model } from '@renderer/types'
import { FC, useMemo } from 'react'
import styled from 'styled-components'

import CitationsList from './CitationsList'

type Citation = {
  number: number
  url: string
  hostname: string
}

interface Props {
  message: Message
  formattedCitations: Citation[] | null
  model?: Model
}

const MessageCitations: FC<Props> = ({ message, formattedCitations, model }) => {
  const isWebCitation = model && (isOpenAIWebSearch(model) || model.provider === 'openrouter')

  // 判断是否有引用内容
  const hasCitations = useMemo(() => {
    return !!(
      (formattedCitations && formattedCitations.length > 0) ||
      (message?.metadata?.webSearch && message.status === 'success') ||
      (message?.metadata?.webSearchInfo && message.status === 'success') ||
      (message?.metadata?.groundingMetadata && message.status === 'success') ||
      (message?.metadata?.knowledge && message.status === 'success')
    )
  }, [formattedCitations, message])

  if (!hasCitations) {
    return null
  }

  return (
    <Container>
      {message?.metadata?.groundingMetadata && message.status === 'success' && (
        <>
          <CitationsList
            citations={
              message.metadata.groundingMetadata?.groundingChunks?.map((chunk, index) => ({
                number: index + 1,
                url: chunk?.web?.uri || '',
                title: chunk?.web?.title,
                showFavicon: false
              })) || []
            }
          />
          <SearchEntryPoint
            dangerouslySetInnerHTML={{
              __html: message.metadata.groundingMetadata?.searchEntryPoint?.renderedContent
                ? message.metadata.groundingMetadata.searchEntryPoint.renderedContent
                    .replace(/@media \(prefers-color-scheme: light\)/g, 'body[theme-mode="light"]')
                    .replace(/@media \(prefers-color-scheme: dark\)/g, 'body[theme-mode="dark"]')
                : ''
            }}
          />
        </>
      )}
      {formattedCitations && (
        <CitationsList
          citations={formattedCitations.map((citation) => ({
            number: citation.number,
            url: citation.url,
            hostname: citation.hostname,
            showFavicon: isWebCitation
          }))}
        />
      )}
      {(message?.metadata?.webSearch || message.metadata?.knowledge) && message.status === 'success' && (
        <CitationsList
          citations={[
            ...(message.metadata.webSearch?.results.map((result, index) => ({
              number: index + 1,
              url: result.url,
              title: result.title,
              showFavicon: true,
              type: 'websearch'
            })) || []),
            ...(message.metadata.knowledge?.map((result, index) => ({
              number: (message.metadata?.webSearch?.results?.length || 0) + index + 1,
              url: result.sourceUrl,
              title: result.sourceUrl,
              showFavicon: true,
              type: 'knowledge'
            })) || [])
          ]}
        />
      )}
      {message?.metadata?.webSearchInfo && message.status === 'success' && (
        <CitationsList
          citations={message.metadata.webSearchInfo.map((result, index) => ({
            number: index + 1,
            url: result.link || result.url,
            title: result.title,
            showFavicon: true
          }))}
        />
      )}
    </Container>
  )
}

const Container = styled.div``

const SearchEntryPoint = styled.div`
  margin: 10px 2px;
`

export default MessageCitations
