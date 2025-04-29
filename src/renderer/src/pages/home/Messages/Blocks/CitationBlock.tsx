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
  const hasCitations = useMemo(() => {
    const hasGeminiBlock = block.response?.source === WebSearchSource.GEMINI
    return (
      (formattedCitations && formattedCitations.length > 0) ||
      hasGeminiBlock ||
      (block.knowledge && block.knowledge.length > 0)
    )
  }, [formattedCitations, block.response, block.knowledge])

  if (block.status === MessageBlockStatus.PROCESSING) {
    return <Spinner text="message.searching" />
  }

  if (!hasCitations) {
    return null
  }

  const isGemini = block.response?.source === WebSearchSource.GEMINI

  return (
    <>
      {block.status === MessageBlockStatus.SUCCESS &&
        (isGemini ? (
          <>
            <CitationsList citations={formattedCitations} />
            <SearchEntryPoint
              dangerouslySetInnerHTML={{
                __html:
                  (block.response?.results as GroundingMetadata)?.searchEntryPoint?.renderedContent
                    ?.replace(/@media \(prefers-color-scheme: light\)/g, 'body[theme-mode="light"]')
                    .replace(/@media \(prefers-color-scheme: dark\)/g, 'body[theme-mode="dark"]') || ''
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
`

export default React.memo(CitationBlock)
