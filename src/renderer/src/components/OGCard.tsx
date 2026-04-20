import Favicon from '@renderer/components/Icons/FallbackFavicon'
import { useMetaDataParser } from '@renderer/hooks/useMetaDataParser'
import { Skeleton } from 'antd'
import { type PropsWithChildren, useCallback, useEffect, useMemo } from 'react'

import MarqueeText from './MarqueeText'

type Props = {
  link: string
  show: boolean
}

export const OGCard = ({ link, show }: Props) => {
  const openGraph = ['og:title', 'og:description', 'og:image', 'og:imageAlt'] as const
  const { metadata, isLoading, parseMetadata } = useMetaDataParser(link, openGraph)

  const hasImage = !!metadata['og:image']

  const hostname = useMemo(() => {
    try {
      return new URL(link).hostname
    } catch {
      return null
    }
  }, [link])

  useEffect(() => {
    // use show to lazy loading
    if (show && isLoading) {
      void parseMetadata()
    }
  }, [parseMetadata, isLoading, show])

  const GeneratedGraph = useCallback(() => {
    return (
      <div className="flex h-48 items-center justify-center bg-accent p-4">
        <h2 className="font-bold text-2xl">{metadata['og:title'] || hostname}</h2>
      </div>
    )
  }, [hostname, metadata])

  if (isLoading) {
    return <CardSkeleton />
  }

  return (
    <Container>
      {hasImage && (
        <div className="flex overflow:hidden h-48 min-h-48 items-center justify-center">
          <img src={metadata['og:image']} alt={metadata['og:imageAlt'] || link} className="max-h-full object-contain" />
        </div>
      )}
      {!hasImage && <GeneratedGraph />}

      <div className="flex min-h-0 flex-col overflow-hidden p-2">
        <div className="mb-2 flex items-center gap-2">
          {hostname && <Favicon hostname={hostname} alt={link} />}
          <MarqueeText>
            <span className="m-0 font-black text-sm leading-tight">{metadata['og:title'] || hostname}</span>
          </MarqueeText>
        </div>

        <div
          title={metadata['og:description'] || link}
          className="line-clamp-3 text-(--color-text-secondary) text-xs leading-tight">
          {metadata['og:description'] || link}
        </div>
      </div>
    </Container>
  )
}

const Container = ({ children }: PropsWithChildren<{}>) => {
  return (
    <div className="flex h-72 w-96 flex-col overflow-hidden rounded-lg border border-(--color-border) bg-(--color-background)">
      {children}
    </div>
  )
}

const CardSkeleton = () => {
  return (
    <Container>
      <Skeleton.Image style={{ width: '100%', height: 192 }} active />
      <Skeleton
        style={{
          padding: 8
        }}
        paragraph={{
          rows: 1,
          style: {
            margin: '8px 0'
          }
        }}
        active
      />
    </Container>
  )
}
