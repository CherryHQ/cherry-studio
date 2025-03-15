import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { Tooltip } from 'antd'
import React from 'react'
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
  let hostname = ''
  try {
    hostname = new URL(citation.url).hostname
  } catch {
    hostname = citation.url
  }

  // 自定义悬浮卡片内容
  const tooltipContent = (
    <TooltipContentWrapper>
      <TooltipHeader onClick={() => window.open(citation.url, '_blank')}>
        <Favicon hostname={hostname} alt={citation.title || hostname} />
        <TooltipTitle title={citation.title || hostname}>{citation.title || hostname}</TooltipTitle>
      </TooltipHeader>
      {citation.content && <TooltipBody>{citation.content}</TooltipBody>}
      <TooltipFooter onClick={() => window.open(citation.url, '_blank')}>{hostname}</TooltipFooter>
    </TooltipContentWrapper>
  )

  return (
    <StyledTooltip
      title={tooltipContent}
      placement="top"
      arrow={false}
      overlayInnerStyle={{
        padding: 0,
        borderRadius: '8px'
      }}>
      {children}
    </StyledTooltip>
  )
}

// 使用styled-components来自定义Tooltip的样式，包括箭头
const StyledTooltip = styled(Tooltip)`
  .ant-tooltip-arrow {
    .ant-tooltip-arrow-content {
      background-color: var(--color-background-1);
    }
  }
`

const TooltipContentWrapper = styled.div`
  padding: 12px;
  background-color: var(--color-background-soft);
  border-radius: 8px;
`

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

export default CitationTooltip
