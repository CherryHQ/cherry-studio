import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { HStack } from '@renderer/components/Layout'
import { fetchWebContent } from '@renderer/utils/fetch'
import { Button, Drawer } from 'antd'
import { FileSearch } from 'lucide-react'
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
}

interface CitationsListProps {
  citations: Citation[]
}

/**
 * 限制文本长度
 * @param text
 * @param maxLength
 */
const truncateText = (text: string, maxLength = 100) => {
  if (!text) return ''
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

/**
 * 清理Markdown内容
 * @param text
 */
const cleanMarkdownContent = (text: string): string => {
  if (!text) return ''
  let cleaned = text.replace(/!\[.*?]\(.*?\)/g, '')
  cleaned = cleaned.replace(/\[(.*?)]\(.*?\)/g, '$1')
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '')
  cleaned = cleaned.replace(/[-—–_=+]{3,}/g, ' ')
  cleaned = cleaned.replace(/[￥$€£¥%@#&*^()[\]{}<>~`'"\\|/_.]+/g, '')
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  return cleaned
}

const CitationsList: React.FC<CitationsListProps> = ({ citations }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const hasCitations = citations.length > 0
  const count = citations.length
  const previewItems = citations.slice(0, 3)

  if (!hasCitations) return null

  const handleOpen = () => {
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
  }

  return (
    <>
      <OpenButton type="text" onClick={handleOpen}>
        <PreviewIcons>
          {previewItems.map((c, i) => (
            <PreviewIcon key={i} style={{ zIndex: previewItems.length - i }}>
              {c.type === 'websearch' && c.url ? (
                <Favicon hostname={new URL(c.url).hostname} alt={''} />
              ) : (
                <FileSearch width={16} />
              )}
            </PreviewIcon>
          ))}
        </PreviewIcons>
        {t('message.citation', { count: count })}
      </OpenButton>

      <Drawer
        title={t('message.citations')}
        placement="right"
        onClose={handleClose}
        open={open}
        width={680}
        destroyOnClose
        styles={{
          body: {
            padding: 16,
            height: 'calc(100% - 55px)'
          }
        }}>
        {citations.map((citation) => (
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
  )
}

const handleLinkClick = (url: string, event: React.MouseEvent) => {
  event.preventDefault()
  if (url.startsWith('http')) window.open(url, '_blank', 'noopener,noreferrer')
  else window.api.file.openPath(url)
}

const WebSearchCitation: React.FC<{ citation: Citation }> = ({ citation }) => {
  const { t } = useTranslation()
  const [fetchedContent, setFetchedContent] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  React.useEffect(() => {
    if (citation.url) {
      setIsLoading(true)
      fetchWebContent(citation.url, 'markdown')
        .then((res) => {
          const cleaned = cleanMarkdownContent(res.content)
          setFetchedContent(truncateText(cleaned, 100))
        })
        .finally(() => setIsLoading(false))
    }
  }, [citation.url])

  return (
    <WebSearchCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {citation.showFavicon && citation.url && (
          <Favicon hostname={new URL(citation.url).hostname} alt={citation.title || citation.hostname || ''} />
        )}
        <CitationLink href={citation.url} onClick={(e) => handleLinkClick(citation.url, e)}>
          {citation.title || <span className="hostname">{citation.hostname}</span>}
        </CitationLink>
      </div>
      {isLoading ? <div>{t('common.loading')}</div> : fetchedContent}
    </WebSearchCard>
  )
}

const KnowledgeCitation: React.FC<{ citation: Citation }> = ({ citation }) => (
  <WebSearchCard>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      {citation.showFavicon && <FileSearch width={16} />}
      <CitationLink href={citation.url} onClick={(e) => handleLinkClick(citation.url, e)}>
        {citation.title}
      </CitationLink>
    </div>
    {citation.content && truncateText(citation.content, 100)}
  </WebSearchCard>
)

const OpenButton = styled(Button)`
  display: flex;
  align-items: center;
  padding: 2px 6px;
  margin-bottom: 8px;
  align-self: flex-start;
  font-size: 12px;
`

const PreviewIcons = styled.div`
  display: flex;
  align-items: center;
  margin-right: 8px;
`

const PreviewIcon = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
  border: 1px solid #e1e4e8;
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

  &:hover {
    text-decoration: underline;
  }

  .hostname {
    color: var(--color-link);
  }
`

const WebSearchCard = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background-color: var(--color-bg-2);
  transition: all 0.3s ease;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    background-color: var(--color-bg-3);
    border-color: var(--color-primary-light);
    transform: translateY(-2px);
  }
`

export default CitationsList
