import { CheckOutlined } from '@ant-design/icons'
import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { HStack } from '@renderer/components/Layout'
import { useSettings } from '@renderer/hooks/useSettings'
import { Collapse, theme, message as antdMessage, Tooltip } from 'antd'
import { FileSearch, Info } from 'lucide-react'
import React, { useMemo, useState } from 'react'
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
  citationCount?: number
}

const CitationsList: React.FC<CitationsListProps> = ({ citations, citationCount }) => {
  const [activeKey, setActiveKey] = useState<'citations' | ''>('')
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()
  const { messageFont } = useSettings()
  useMemo(() => {
    return messageFont === 'serif'
      ? 'serif'
      : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans","Helvetica Neue", sans-serif'
  }, [messageFont])

  const { token } = theme.useToken()
  const items = useMemo(() => {
    return !citations || citations.length === 0
      ? []
      : [
          {
            key: '1',
            label: (
              <CitationsTitle>
                <span>{t('message.citations')}</span>
                <Info size={14} style={{ opacity: 0.6 }} />
              </CitationsTitle>
            ),
            style: {
              backgroundColor: token.colorFillAlter
            },
            children: (
              <>
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
              </>
            )
          }
        ]
  }, [citations, t])

  if (!citations || citations.length === 0) return null

  const count = citationCount || citations.length

  const copyAllCitations = () => {
    // 获取所有引用URL并复制到剪贴板
    const urls = citations
      .map((citation) => citation.url)
      .filter(Boolean)
      .join('\n')

    if (urls) {
      navigator.clipboard.writeText(urls)
      antdMessage.success({ content: t('message.copied'), key: 'copy-citations' })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <CollapseContainer
      activeKey={activeKey}
      size="small"
      onChange={() => setActiveKey((key) => (key ? '' : 'citations'))}
      className="message-thought-container"
      items={[
        {
          key: 'citations',
          label: (
            <MessageTitleLabel>
              <TitleText>
                {t('message.citations')} ({count})
              </TitleText>
              <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
                <ActionButton
                  className="message-action-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    copyAllCitations()
                  }}
                  aria-label={t('common.copy')}>
                  {!copied && <i className="iconfont icon-copy"></i>}
                  {copied && <CheckOutlined style={{ color: 'var(--color-primary)' }} />}
                </ActionButton>
              </Tooltip>
            </MessageTitleLabel>
          ),
          children: citations.map((citation) => (
            <HStack key={citation.url || citation.number} style={{ alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-2)' }}>{citation.number}.</span>
              {citation.type === 'websearch' ? (
                <WebSearchCitation citation={citation} />
              ) : (
                <KnowledgeCitation citation={citation} />
              )}
            </HStack>
          ))
        }
      ]}
    />
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

const CollapseContainer = styled(Collapse)`
  margin-bottom: 15px;
`

const MessageTitleLabel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 22px;
  gap: 15px;
`

const TitleText = styled.span`
  color: var(--color-text-2);
  display: flex;
  align-items: center;
  gap: 5px;
`

const ActionButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-2);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  opacity: 0.6;
  transition: all 0.3s;

  &:hover {
    opacity: 1;
    color: var(--color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .iconfont {
    font-size: 14px;
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
