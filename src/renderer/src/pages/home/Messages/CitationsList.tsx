import ContextMenu from '@renderer/components/ContextMenu'
import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { Citation } from '@renderer/types'
import { fetchWebContent } from '@renderer/utils/fetch'
import { cleanMarkdownContent } from '@renderer/utils/formats'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Button, message, Popover, Skeleton } from 'antd'
import { Check, Copy, FileSearch } from 'lucide-react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface CitationsListProps {
  citations: Citation[]
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false
    }
  }
})

/**
 * 限制文本长度
 * @param text
 * @param maxLength
 */
const truncateText = (text: string, maxLength = 100) => {
  if (!text) return ''
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

const CitationsList: React.FC<CitationsListProps> = ({ citations }) => {
  const { t } = useTranslation()

  const previewItems = citations.slice(0, 3)
  const count = citations.length
  if (!count) return null

  const popoverContent = (
    <div>
      {citations.map((citation) => (
        <PopoverContentItem key={citation.url || citation.number}>
          {citation.type === 'websearch' ? (
            <PopoverContent>
              <WebSearchCitation citation={citation} />
            </PopoverContent>
          ) : (
            <KnowledgePopoverContent>
              <KnowledgeCitation citation={citation} />
            </KnowledgePopoverContent>
          )}
        </PopoverContentItem>
      ))}
    </div>
  )

  return (
    <QueryClientProvider client={queryClient}>
      <Popover
        arrow={false}
        content={popoverContent}
        title={
          <div
            style={{
              padding: '8px 12px 8px',
              marginBottom: -8,
              fontWeight: 'bold',
              borderBottom: '0.5px solid var(--color-border)'
            }}>
            {t('message.citations')}
          </div>
        }
        placement="right"
        trigger="click"
        styles={{
          body: {
            padding: '0 0 8px 0'
          }
        }}>
        <OpenButton type="text">
          <PreviewIcons>
            {previewItems.map((c, i) => (
              <PreviewIcon key={i} style={{ zIndex: previewItems.length - i }}>
                {c.type === 'websearch' && c.url ? (
                  <Favicon hostname={new URL(c.url).hostname} alt={c.title || ''} />
                ) : (
                  <FileSearch width={16} />
                )}
              </PreviewIcon>
            ))}
          </PreviewIcons>
          {t('message.citation', { count })}
        </OpenButton>
      </Popover>
    </QueryClientProvider>
  )
}

const handleLinkClick = (url: string, event: React.MouseEvent) => {
  event.preventDefault()
  if (url.startsWith('http')) window.open(url, '_blank', 'noopener,noreferrer')
  else window.api.file.openPath(url)
}

const CopyButton: React.FC<{ content: string }> = ({ content }) => {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()

  const handleCopy = () => {
    if (!content) return
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true)
        message.success(t('common.copied'))
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {
        message.error(t('message.copy.failed'))
      })
  }

  return <CopyIconWrapper onClick={handleCopy}>{copied ? <Check size={14} /> : <Copy size={14} />}</CopyIconWrapper>
}

const WebSearchCitation: React.FC<{ citation: Citation }> = ({ citation }) => {
  const { data: fetchedContent, isLoading } = useQuery({
    queryKey: ['webContent', citation.url],
    queryFn: async () => {
      if (!citation.url) return ''
      const res = await fetchWebContent(citation.url, 'markdown')
      return cleanMarkdownContent(res.content)
    },
    enabled: Boolean(citation.url),
    select: (content) => truncateText(content, 100)
  })

  return (
    <ContextMenu>
      <WebSearchCard>
        <WebSearchCardHeader>
          {citation.showFavicon && citation.url && (
            <Favicon hostname={new URL(citation.url).hostname} alt={citation.title || citation.hostname || ''} />
          )}
          <CitationLink className="text-nowrap" href={citation.url} onClick={(e) => handleLinkClick(citation.url, e)}>
            {citation.title || <span className="hostname">{citation.hostname}</span>}
          </CitationLink>

          <CitationIndex>{citation.number}</CitationIndex>
          {fetchedContent && <CopyButton content={fetchedContent} />}
        </WebSearchCardHeader>
        {isLoading ? (
          <Skeleton active paragraph={{ rows: 1 }} title={false} />
        ) : (
          <WebSearchCardContent className="selectable-text">{fetchedContent}</WebSearchCardContent>
        )}
      </WebSearchCard>
    </ContextMenu>
  )
}

const KnowledgeCitation: React.FC<{ citation: Citation }> = ({ citation }) => {
  return (
    <ContextMenu>
      <WebSearchCard>
        <WebSearchCardHeader>
          {citation.showFavicon && <FileSearch width={16} />}
          <CitationLink className="text-nowrap" href={citation.url} onClick={(e) => handleLinkClick(citation.url, e)}>
            {/* example title: User/path/example.pdf */}
            {citation.title?.split('/').pop()}
          </CitationLink>
          <CitationIndex>{citation.number}</CitationIndex>
          {citation.content && <CopyButton content={citation.content} />}
        </WebSearchCardHeader>
        <WebSearchCardContent className="selectable-text">{citation.content && citation.content}</WebSearchCardContent>
      </WebSearchCard>
    </ContextMenu>
  )
}

const OpenButton = styled(Button)`
  display: flex;
  align-items: center;
  padding: 3px 8px;
  margin: 8px 0;
  align-self: flex-start;
  font-size: 12px;
  background-color: var(--color-background-soft);
  border-radius: var(--list-item-border-radius);
`

const PreviewIcons = styled.div`
  display: flex;
  align-items: center;
`

const PreviewIcon = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  margin-left: -8px;
  color: var(--color-text-2);

  &:first-child {
    margin-left: 0;
  }
`

const CitationIndex = styled.div`
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: var(--color-reference);
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-reference-text);
  flex-shrink: 0;
  opacity: 1;
  transition: opacity 0.3s ease;
`

const CitationLink = styled.a`
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-1);
  text-decoration: none;
  flex: 1;
  .hostname {
    color: var(--color-link);
  }
`

const CopyIconWrapper = styled.div`
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
  opacity: 0;
  padding: 4px;
  border-radius: 4px;
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  transition: opacity 0.3s ease;

  &:hover {
    opacity: 1;
    background-color: var(--color-background-soft);
  }
`

const WebSearchCard = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 12px 0;
  transition: all 0.3s ease;
  position: relative;
  &:hover {
    ${CopyIconWrapper} {
      opacity: 1;
    }
    ${CitationIndex} {
      opacity: 0;
    }
  }
`

const WebSearchCardHeader = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  width: 100%;
  position: relative;
`

const WebSearchCardContent = styled.div`
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-2);
  user-select: text;
  cursor: text;
  word-break: break-all;

  &.selectable-text {
    -webkit-user-select: text;
    -moz-user-select: text;
    -ms-user-select: text;
    user-select: text;
  }
`

const PopoverContent = styled.div`
  max-width: min(400px, 60vw);
  max-height: 60vh;
  padding: 0 12px;
`

const KnowledgePopoverContent = styled(PopoverContent)`
  max-width: 600px;
`

const PopoverContentItem = styled.div`
  border-bottom: 0.5px solid var(--color-border);
  &:last-child {
    border-bottom: none;
  }
`

export default CitationsList
