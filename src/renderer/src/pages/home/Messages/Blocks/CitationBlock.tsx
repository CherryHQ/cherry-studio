import { DownOutlined, InfoCircleOutlined, UpOutlined } from '@ant-design/icons'
import { isOpenAIWebSearch } from '@renderer/config/models'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import CitationsList from '../CitationsList'

export default function CitationBlock({ model, block }) {
  const { t } = useTranslation()
  const isWebCitation = model && (isOpenAIWebSearch(model) || model.provider === 'openrouter')
  const [citationsCollapsed, setCitationsCollapsed] = useState(true)

  const formattedCitations = useMemo(() => {
    if (!block.metadata?.citations?.length && !block.metadata?.annotations?.length) return null

    let citations: any[] = []

    if (model && isOpenAIWebSearch(model)) {
      citations =
        block.metadata.annotations?.map((url, index) => {
          return { number: index + 1, url: url.url_citation?.url, hostname: url.url_citation.title }
        }) || []
    } else {
      citations =
        block.metadata?.citations?.map((url, index) => {
          try {
            const hostname = new URL(url).hostname
            return { number: index + 1, url, hostname }
          } catch {
            return { number: index + 1, url, hostname: url }
          }
        }) || []
    }

    // Deduplicate by URL
    const urlSet = new Set()
    return citations
      .filter((citation) => {
        if (!citation.url || urlSet.has(citation.url)) return false
        urlSet.add(citation.url)
        return true
      })
      .map((citation, index) => ({
        ...citation,
        number: index + 1 // Renumber citations sequentially after deduplication
      }))
  }, [block.metadata?.citations, block.metadata?.annotations, model])

  const hasCitations = useMemo(() => {
    return !!(
      (formattedCitations && formattedCitations.length > 0) ||
      (block?.metadata?.webSearch && block.status === 'success') ||
      (block?.metadata?.webSearchInfo && block.status === 'success') ||
      (block?.metadata?.groundingMetadata && block.status === 'success')
    )
  }, [formattedCitations, block])

  return (
    <>
      {hasCitations && (
        <CitationsContainer>
          <CitationsHeader onClick={() => setCitationsCollapsed(!citationsCollapsed)}>
            <div>
              {t('block.citations')}
              <InfoCircleOutlined style={{ fontSize: '14px', marginLeft: '4px', opacity: 0.6 }} />
            </div>
            {citationsCollapsed ? <DownOutlined /> : <UpOutlined />}
          </CitationsHeader>

          {!citationsCollapsed && (
            <CitationsContent>
              {block?.metadata?.groundingMetadata && block.status === 'success' && (
                <>
                  <CitationsList
                    citations={
                      block.metadata.groundingMetadata?.groundingChunks?.map((chunk, index) => ({
                        number: index + 1,
                        url: chunk?.web?.uri || '',
                        title: chunk?.web?.title,
                        showFavicon: false
                      })) || []
                    }
                  />
                  <SearchEntryPoint
                    dangerouslySetInnerHTML={{
                      __html: block.metadata.groundingMetadata?.searchEntryPoint?.renderedContent
                        ? block.metadata.groundingMetadata.searchEntryPoint.renderedContent
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
              {block?.metadata?.webSearch && block.status === 'success' && (
                <CitationsList
                  citations={block.metadata.webSearch.results.map((result, index) => ({
                    number: index + 1,
                    url: result.url,
                    title: result.title,
                    showFavicon: true
                  }))}
                />
              )}
              {block?.metadata?.webSearchInfo && block.status === 'success' && (
                <CitationsList
                  citations={block.metadata.webSearchInfo.map((result, index) => ({
                    number: index + 1,
                    url: result.link || result.url,
                    title: result.title,
                    showFavicon: true
                  }))}
                />
              )}
            </CitationsContent>
          )}
        </CitationsContainer>
      )}
    </>
  )
}

const SearchEntryPoint = styled.div`
  margin: 10px 2px;
`
const CitationsContainer = styled.div`
  margin-top: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
`

const CitationsHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: var(--color-background-mute);
  cursor: pointer;

  &:hover {
    background-color: var(--color-border);
  }
`

const CitationsContent = styled.div`
  padding: 10px;
  background-color: var(--color-background-mute);
`
