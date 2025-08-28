import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { Popover } from 'antd'
import React, { memo, useMemo } from 'react'
import styled from 'styled-components'

interface HyperLinkProps {
  children: React.ReactNode
  href: string
}
const Hyperlink: React.FC<HyperLinkProps> = ({ children, href }) => {
  const link = useMemo(() => {
    try {
      return decodeURIComponent(href)
    } catch {
      return href
    }
  }, [href])

  const hostname = useMemo(() => {
    try {
      return new URL(link).hostname
    } catch {
      return null
    }
  }, [link])

  if (!href) return children

  return (
    <Popover
      arrow={false}
      content={
        <StyledHyperLink>
          {hostname && <Favicon hostname={hostname} alt={link} />}
          <span>{link}</span>
        </StyledHyperLink>
      }
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
    </Popover>
  )
}

const StyledHyperLink = styled.div`
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
  span {
    max-width: min(400px, 70vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

export default memo(Hyperlink)
