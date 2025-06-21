import { GroundingMetadata } from '@google/genai'
import Spinner from '@renderer/components/Spinner'
import type { RootState } from '@renderer/store'
import { selectFormattedCitationsByBlockId } from '@renderer/store/messageBlock'
import { WebSearchSource } from '@renderer/types'
import { type CitationMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import React, { useMemo } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

import CitationsList from '../CitationsList'

function CitationBlock({ block }: { block: CitationMessageBlock }) {
  const formattedCitations = useSelector((state: RootState) => selectFormattedCitationsByBlockId(state, block.id))
  const hasGeminiBlock = block.response?.source === WebSearchSource.GEMINI
  const hasCitations = useMemo(() => {
    return (
      (formattedCitations && formattedCitations.length > 0) ||
      hasGeminiBlock ||
      (block.knowledge && block.knowledge.length > 0) ||
      (block.memories && block.memories.length > 0)
    )
  }, [formattedCitations, block.knowledge, block.memories, hasGeminiBlock])

  if (block.status === MessageBlockStatus.PROCESSING) {
    return <Spinner text="message.searching" />
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
