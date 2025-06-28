import { GroundingMetadata } from '@google/genai'
import Spinner from '@renderer/components/Spinner'
import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { WebSearchSource } from '@renderer/types'
import { type CitationMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import CitationsList from '../CitationsList'

function CitationBlock({ block }: { block: CitationMessageBlock }) {
  const { t } = useTranslation()
  const formattedCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, block.id))
  const { websearch } = useSelector((state: RootState) => state.runtime)
  const message = useSelector((state: RootState) => state.messages.entities[block.messageId])
  const userMessageId = message?.askId || block.messageId // 如果没有 askId 则回退到 messageId

  const hasGeminiBlock = block.response?.source === WebSearchSource.GEMINI
  const hasCitations = useMemo(() => {
    return (
      (formattedCitations && formattedCitations.length > 0) ||
      hasGeminiBlock ||
      (block.knowledge && block.knowledge.length > 0)
    )
  }, [formattedCitations, block.knowledge, hasGeminiBlock])

  const getWebSearchStatusText = (requestId: string) => {
    const status = websearch.activeSearches[requestId] ?? { phase: 'default' }

    switch (status.phase) {
      case 'fetch_complete':
        return t('message.websearch.fetch_complete', {
          count: status.countAfter ?? 0
        })
      case 'rag':
        return t('message.websearch.rag')
      case 'rag_complete':
        return t('message.websearch.rag_complete', {
          countBefore: status.countBefore ?? 0,
          countAfter: status.countAfter ?? 0
        })
      case 'rag_failed':
        return t('message.websearch.rag_failed')
      case 'cutoff':
        return t('message.websearch.cutoff')
      default:
        return t('message.searching')
    }
  }

  if (block.status === MessageBlockStatus.PROCESSING) {
    return <Spinner text={getWebSearchStatusText(userMessageId)} />
  }

  if (!hasCitations) {
    return null
  }

  return (
    <>
      {block.status === MessageBlockStatus.SUCCESS &&
        (hasGeminiBlock ? (
          <>
            <CitationsList citations={formattedCitations} />
            <SearchEntryPoint
              dangerouslySetInnerHTML={{
                __html:
                  (block.response?.results as GroundingMetadata)?.searchEntryPoint?.renderedContent
                    ?.replace(/@media \(prefers-color-scheme: light\)/g, 'body[theme-mode="light"]')
                    .replace(/@media \(prefers-color-scheme: dark\)/g, 'body[theme-mode="dark"]')
                    .replace(
                      /background-color\s*:\s*#[0-9a-fA-F]{3,6}\b|\bbackground-color\s*:\s*[a-zA-Z-]+\b/g,
                      'background-color: var(--color-background-soft)'
                    )
                    .replace(/\.gradient\s*{[^}]*background\s*:\s*[^};]+[;}]/g, (match) => {
                      // Remove the background property while preserving the rest
                      return match.replace(/background\s*:\s*[^};]+;?\s*/g, '')
                    })
                    .replace(/\.chip {\n/g, '.chip {\n background-color: var(--color-background)!important;\n')
                    .replace(/border-color\s*:\s*[^};]+;?\s*/g, '')
                    .replace(/border\s*:\s*[^};]+;?\s*/g, '') || ''
              }}
            />
          </>
        ) : (
          formattedCitations.length > 0 && <CitationsList citations={formattedCitations} />
        ))}
    </>
  )
}

const SearchEntryPoint = styled.div`
  margin: 10px 2px;
  @media (max-width: 768px) {
    display: none;
  }
  .carousel {
    white-space: normal;
    .chip {
      margin: 0;
      margin-left: 5px;
    }
  }
`

export default React.memo(CitationBlock)
