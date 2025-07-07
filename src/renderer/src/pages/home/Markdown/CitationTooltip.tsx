import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { Tooltip } from 'antd'
import React, { memo, useCallback, useMemo } from 'react'
import styled from 'styled-components'

interface CitationTooltipProps {
  children: React.ReactNode
  citation: {
    url: string
    title?: string
    content?: string
  }
}

const CitationTooltip: React.FC<CitationTooltipProps> = ({ children, citation }) => {
  const hostname = useMemo(() => {
    try {
      return new URL(citation.url).hostname
    } catch {
      return citation.url
    }
  }, [citation.url])

  const sourceTitle = useMemo(() => {
    return citation.title?.trim() || hostname
  }, [citation.title, hostname])

  const handleClick = useCallback(() => {
    window.open(citation.url, '_blank', 'noopener,noreferrer')
  }, [citation.url])

  // 自定义悬浮卡片内容
  const tooltipContent = useMemo(
    () => (
      <div style={{ userSelect: 'text' }}>
        <TooltipHeader role="button" aria-label={`Open ${sourceTitle} in new tab`} onClick={handleClick}>
          <Favicon hostname={hostname} alt={sourceTitle} />
          <TooltipTitle role="heading" aria-level={3} title={sourceTitle}>
            {sourceTitle}
          </TooltipTitle>
        </TooltipHeader>
        {citation.content?.trim() && (
          <TooltipBody role="article" aria-label="Citation content">
            {citation.content}
          </TooltipBody>
        )}
        <TooltipFooter role="button" aria-label={`Visit ${hostname}`} onClick={handleClick}>
          {hostname}
        </TooltipFooter>
      </div>
    ),
    [citation.content, hostname, handleClick, sourceTitle]
  )

  return (
    <Tooltip
      arrow={false}
      overlay={tooltipContent}
      placement="top"
      color="var(--color-background)"
      styles={{
        body: {
          border: '1px solid var(--color-border)',
          padding: '12px',
          borderRadius: '8px'
        }
      }}>
      {children}
    </Tooltip>
  )
}

const TooltipHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  cursor: pointer;

  &:hover {
    opacity: 0.8;
  }
`

const TooltipTitle = styled.div`
  color: var(--color-text-1);
  font-size: 14px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TooltipBody = styled.div`
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 8px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  color: var(--color-text-2);
`

const TooltipFooter = styled.div`
  font-size: 12px;
  color: var(--color-link);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`

export default memo(CitationTooltip)
