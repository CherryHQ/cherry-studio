import 'og-crd/style.css'

import { Skeleton } from '@cherrystudio/ui'
import { useMetaDataParser } from '@renderer/hooks/useMetaDataParser'
import { OgCard as OgCrdCard } from 'og-crd'
import { type CSSProperties, type PropsWithChildren, useEffect, useMemo } from 'react'

type Props = {
  link: string
  show: boolean
}

const METADATA_FIELDS = [
  'og:title',
  'og:description',
  'og:image',
  'og:imageAlt',
  'title',
  'description',
  'image'
] as const

export const OgCard = ({ link, show }: Props) => {
  const { metadata, isLoading, parseMetadata } = useMetaDataParser(link, METADATA_FIELDS)

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

  if (isLoading) {
    return <CardSkeleton />
  }

  const title = metadata['og:title'] || metadata.title || hostname || link
  const description = metadata['og:description'] || metadata.description || link
  const imageUrl = metadata['og:image'] || metadata.image
  const thumbnail = imageUrl ? (
    <img
      src={imageUrl}
      alt={metadata['og:imageAlt'] || title}
      className="h-full w-full bg-muted"
      style={{ objectFit: 'cover' }}
    />
  ) : (
    <div className="h-full w-full bg-accent" />
  )

  return (
    <Container>
      <OgCrdCard
        thumbnail={thumbnail}
        title={title}
        description={description}
        href={link}
        aspectRatio={760 / 420}
        hoverEffect="none"
        className="h-full w-full"
      />
    </Container>
  )
}

const Container = ({ children }: PropsWithChildren<{}>) => {
  const cardStyle = {
    '--og-card-shadow': 'none',
    '--og-card-shadow-hover': 'none',
    '--og-card-radius': '8px'
  } as CSSProperties

  return (
    <div
      className="aspect-760/420 w-100 max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-(--color-border) bg-(--color-background)"
      style={cardStyle}>
      {children}
    </div>
  )
}

const CardSkeleton = () => {
  return (
    <Container>
      <Skeleton className="h-full w-full rounded-none" />
    </Container>
  )
}
