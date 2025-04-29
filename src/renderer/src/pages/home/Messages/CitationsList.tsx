import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { HStack } from '@renderer/components/Layout'
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

const truncateText = (text: string, maxLength = 100) => {
  if (!text) return ''
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

const CitationsList: React.FC<CitationsListProps> = ({ citations }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const hasCitations = citations.length > 0
  const count = citations.length
  const previewItems = citations.slice(0, 3)
  const extraCount = count - previewItems.length

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
          {extraCount > 0 && <MoreCount style={{ zIndex: 0 }}>+{extraCount}</MoreCount>}
        </PreviewIcons>
        {t('message.citations')}
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

const WebSearchCitation: React.FC<{ citation: Citation }> = ({ citation }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {citation.showFavicon && citation.url && (
        <Favicon hostname={new URL(citation.url).hostname} alt={citation.title || citation.hostname || ''} />
      )}
      <CitationLink href={citation.url} onClick={(e) => handleLinkClick(citation.url, e)}>
        {citation.title || <span className="hostname">{citation.hostname}</span>}
      </CitationLink>
    </div>
    {citation.content && <CitationContent>{truncateText(citation.content, 100)}</CitationContent>}
  </div>
)

const KnowledgeCitation: React.FC<{ citation: Citation }> = ({ citation }) => (
  <>
    {citation.showFavicon && <FileSearch width={16} />}
    <CitationLink href={citation.url} onClick={(e) => handleLinkClick(citation.url, e)}>
      {citation.title}
    </CitationLink>
  </>
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
  background: #fff;
  border: 1px solid #fff;
  margin-left: -8px;

  &:first-child {
    margin-left: 0;
  }
`

const MoreCount = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
  background: #fff;
  border: 1px solid #fff;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  margin-left: -8px;
`

const CitationContent = styled.div`
  margin-left: 24px;
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-text-2);
  line-height: 1.5;
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

export default CitationsList
