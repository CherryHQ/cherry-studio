import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { useMetaDataParser } from '@renderer/hooks/useMetaDataParser'
import { Popover, Skeleton, Typography } from 'antd'
import React, { memo, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

interface HyperLinkProps {
  children: React.ReactNode
  href: string
}
const { Text, Title } = Typography

const Hyperlink: React.FC<HyperLinkProps> = ({ children, href }) => {
  const [open, setOpen] = useState(false)

  const link = useMemo(() => {
    try {
      return decodeURIComponent(href)
    } catch {
      return href
    }
  }, [href])

  const openGraph = ['og:title', 'og:description', 'og:image', 'og:imageAlt'] as const
  const { metadata, isLoading, isLoaded, parseMetadata } = useMetaDataParser(link, openGraph)

  const hostname = useMemo(() => {
    try {
      return new URL(link).hostname
    } catch {
      return null
    }
  }, [link])

  useEffect(() => {
    if (open && !isLoaded) {
      parseMetadata()
    }
  }, [parseMetadata, open])

  if (!href) return children

  const renderContent = () => {
    if (isLoading) {
      return (
        <LoadingContainer>
          <Skeleton active />
        </LoadingContainer>
      )
    }

    const hasImage = !!metadata['og:image']

    return (
      <PreviewContainer hasImage={hasImage}>
        {hasImage && (
          <PreviewImageContainer>
            <PreviewImage src={metadata['og:image']} alt={metadata['og:imageAlt'] || link} />
          </PreviewImageContainer>
        )}

        <PreviewContent>
          <StyledHyperLink>
            {hostname && <Favicon hostname={hostname} alt={link} />}
            <Title
              style={{
                margin: 0,
                fontSize: '14px',
                lineHeight: '1.2',
                color: 'var(--color-text)'
              }}>
              {metadata['og:title'] || hostname}
            </Title>
          </StyledHyperLink>
          <Text
            style={{
              fontSize: '12px',
              lineHeight: '1.2',
              color: 'var(--color-text-secondary)'
            }}>
            {metadata['og:description'] || link}
          </Text>
        </PreviewContent>
      </PreviewContainer>
    )
  }

  return (
    <Popover
      arrow={false}
      open={open}
      onOpenChange={setOpen}
      content={renderContent()}
      placement="top"
      overlayStyle={{ maxWidth: '480px' }}
      styles={{
        body: {
          padding: 0,
          borderRadius: '8px',
          overflow: 'hidden'
        }
      }}>
      {children}
    </Popover>
  )
}

const StyledHyperLink = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const LoadingContainer = styled.div`
  width: 380px;
  padding: 12px 16px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
`

const PreviewContainer = styled.div<{ hasImage?: boolean }>`
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  max-width: 480px;
  min-width: 320px;
  overflow: hidden;
`

const PreviewImageContainer = styled.div`
  width: 100%;
  height: 200px;
  overflow: hidden;
`

const PreviewContent = styled.div`
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PreviewImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`

export default memo(Hyperlink)
