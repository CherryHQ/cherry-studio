import { useSharedCache } from '@data/hooks/useCache'
import type { GroundingMetadata } from '@google/genai'
import Spinner from '@renderer/components/Spinner'
import { formatCitationsFromBlock } from '@renderer/store/messageBlock'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import { type CitationMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import CitationsList from '../CitationsList'

/**
 * @deprecated Legacy block component.
 * V2 parts rendering handles citations in PartsRenderer/MainTextBlock.
 */
function CitationBlock({ block }: { block: CitationMessageBlock }) {
  const { t } = useTranslation()
  const formattedCitations = formatCitationsFromBlock(block)
  const userMessageId = block.messageId
  const [activeSearches] = useSharedCache('chat.web_search.active_searches')

  const hasGeminiBlock = block.response?.source === WEB_SEARCH_SOURCE.GEMINI
  const hasCitations = useMemo(() => {
    return (
      (formattedCitations && formattedCitations.length > 0) ||
      hasGeminiBlock ||
      (block.knowledge && block.knowledge.length > 0) ||
      (block.memories && block.memories.length > 0)
    )
  }, [formattedCitations, block.knowledge, block.memories, hasGeminiBlock])

  const getWebSearchStatusText = (requestId: string) => {
    const status = activeSearches[requestId] ?? { phase: 'default' }

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
            <div
              className="mx-0.5 my-2 hidden md:block [&_.carousel]:whitespace-normal [&_.carousel_.chip]:m-0 [&_.carousel_.chip]:ml-[5px]"
              dangerouslySetInnerHTML={{
                __html:
                  (block.response?.results as GroundingMetadata)?.searchEntryPoint?.renderedContent
                    ?.replace(/@media \(prefers-color-scheme: light\)/g, 'body.light')
                    .replace(/@media \(prefers-color-scheme: dark\)/g, 'body.dark')
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

export default React.memo(CitationBlock)
