import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { HStack } from '@renderer/components/Layout'
import { FileSearch } from 'lucide-react'
import React from 'react'
import styled from 'styled-components'

interface Citation {
  number: number
  url: string
  title?: string
  hostname?: string
  showFavicon?: boolean
  type?: string
}

interface CitationsListProps {
  citations: Citation[]
  hideTitle?: boolean
}

const CitationsList: React.FC<CitationsListProps> = ({ citations }) => {
  console.log('CitationsList', citations)
  if (!citations || citations.length === 0) return null

  return (
    <CitationsContainer className="footnotes">
      {citations.map((citation) => (
        <HStack key={citation.url || citation.number} style={{ alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-2)' }}>{citation.number}.</span>
          {citation.type === 'websearch' ? (
            <WebSearchCitation citation={citation} />
          ) : (
            <KnowledgeCitation citation={citation} />
          )}
        </HStack>
      ))}
    </CitationsContainer>
  )
}

const handleLinkClick = (url: string, event: React.MouseEvent) => {
  if (!url) return

  event.preventDefault()

  // 检查是否是网络URL
  if (url.startsWith('http://') || url.startsWith('https://')) {
    window.open(url, '_blank', 'noopener,noreferrer')
  } else {
    try {
      window.api.file.openPath(url)
    } catch (error) {
      console.error('打开本地文件失败:', error)
    }
  }
}

// 网络搜索引用组件
const WebSearchCitation: React.FC<{ citation: Citation }> = ({ citation }) => {
  return (
    <>
      {citation.showFavicon && citation.url && (
        <Favicon hostname={new URL(citation.url).hostname} alt={citation.title || citation.hostname || ''} />
      )}
      <CitationLink href={citation.url} className="text-nowrap" onClick={(e) => handleLinkClick(citation.url, e)}>
        {citation.title ? citation.title : <span className="hostname">{citation.hostname}</span>}
      </CitationLink>
    </>
  )
}

// 知识库引用组件
const KnowledgeCitation: React.FC<{ citation: Citation }> = ({ citation }) => {
  return (
    <>
      {citation.showFavicon && citation.url && <FileSearch width={16} />}
      <CitationLink href={citation.url} className="text-nowrap" onClick={(e) => handleLinkClick(citation.url, e)}>
        {citation.title}
      </CitationLink>
    </>
  )
}

const CitationsContainer = styled.div`
  background-color: rgb(242, 247, 253);
  border-radius: 4px;
  padding: 8px 12px;
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;

  body[theme-mode='dark'] & {
    background-color: rgba(255, 255, 255, 0.05);
  }
`

const CitationLink = styled.a`
  font-size: 14px;
  line-height: 1.6;
  text-decoration: none;
  color: var(--color-text-1);

  .hostname {
    color: var(--color-link);
  }

  &:hover {
    text-decoration: underline;
  }
`

export default CitationsList
