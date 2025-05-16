import ContextMenu from '@renderer/components/ContextMenu'
import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { HStack } from '@renderer/components/Layout'
import { fetchWebContent } from '@renderer/utils/fetch'
import { cleanMarkdownContent } from '@renderer/utils/formats'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Button, Drawer, message, Skeleton } from 'antd'
import { Check, Copy, FileSearch } from 'lucide-react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface Citation {
  number: number
  url: string
  title?: string
  hostname?: string
  content?: string
  showFavicon?: boolean
  type?: string
  metadata?: Record<string, any>
}

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
  const [open, setOpen] = useState(false)

  const previewItems = citations.slice(0, 3)
  const count = citations.length
  if (!count) return null

  return (
    <QueryClientProvider client={queryClient}>
      <>
        <OpenButton type="text" onClick={() => setOpen(true)}>
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

        <Drawer
          title={t('message.citations')}
          placement="right"
          onClose={() => setOpen(false)}
          open={open}
          width={680}
          styles={{ header: { border: 'none' }, body: { paddingTop: 0 } }}
          destroyOnClose={false}>
          {open &&
            citations.map((citation) => (
              <HStack key={citation.url || citation.number} style={{ alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {citation.type === 'websearch' ? (
                  <WebSearchCitation citation={citation} />
                ) : (
                  <KnowledgeCitation citation={citation} />
                )}
              </HStack>
            ))}
        </Drawer>
      </>
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
    <WebSearchCard>
      <ContextMenu>
        <WebSearchCardHeader>
          {citation.showFavicon && citation.url && (
            <Favicon hostname={new URL(citation.url).hostname} alt={citation.title || citation.hostname || ''} />
          )}
          <CitationLink className="text-nowrap" href={citation.url} onClick={(e) => handleLinkClick(citation.url, e)}>
            {citation.title || <span className="hostname">{citation.hostname}</span>}
          </CitationLink>
          {fetchedContent && <CopyButton content={fetchedContent} />}
        </WebSearchCardHeader>
        {isLoading ? (
          <Skeleton active paragraph={{ rows: 1 }} title={false} />
        ) : (
          <WebSearchCardContent className="selectable-text">{fetchedContent}</WebSearchCardContent>
        )}
      </ContextMenu>
    </WebSearchCard>
  )
}

const KnowledgeCitation: React.FC<{ citation: Citation }> = ({ citation }) => {
  return (
    <WebSearchCard>
      <ContextMenu>
        <WebSearchCardHeader>
          {citation.showFavicon && <FileSearch width={16} />}
          <CitationLink className="text-nowrap" href={citation.url} onClick={(e) => handleLinkClick(citation.url, e)}>
            {citation.title}
          </CitationLink>
          {citation.content && <CopyButton content={citation.content} />}
        </WebSearchCardHeader>
        <WebSearchCardContent className="selectable-text">
          {citation.content && truncateText(citation.content, 100)}
        </WebSearchCardContent>
      </ContextMenu>
    </WebSearchCard>
  )
}

const OpenButton = styled(Button)`
  display: flex;
  align-items: center;
  padding: 3px 8px;
  margin-bottom: 8px;
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

const CitationLink = styled.a`
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-1);
  text-decoration: none;

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
  opacity: 0.6;
  margin-left: auto;
  padding: 4px;
  border-radius: 4px;

  &:hover {
    opacity: 1;
    background-color: var(--color-background-soft);
  }
`

const WebSearchCard = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 12px;
  border-radius: var(--list-item-border-radius);
  background-color: var(--color-background);
  transition: all 0.3s ease;
  position: relative;
`

const WebSearchCardHeader = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  width: 100%;
`

const WebSearchCardContent = styled.div`
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-2);
  user-select: text;
  cursor: text;

  &.selectable-text {
    -webkit-user-select: text;
    -moz-user-select: text;
    -ms-user-select: text;
    user-select: text;
  }
`

export default CitationsList
