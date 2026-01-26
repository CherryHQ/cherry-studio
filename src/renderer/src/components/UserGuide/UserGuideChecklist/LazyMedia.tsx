import { Skeleton } from 'antd'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import styled from 'styled-components'

interface LazyMediaProps {
  type: 'image' | 'video'
  src: string
  alt?: string
}

const LazyMedia: FC<LazyMediaProps> = ({ type, src, alt = '' }) => {
  const [isLoaded, setIsLoaded] = useState(false)

  const handleLoad = useCallback(() => {
    setIsLoaded(true)
  }, [])

  return (
    <MediaWrapper>
      {!isLoaded && (
        <SkeletonWrapper>
          <Skeleton.Image active style={{ width: '100%', height: '100%' }} />
        </SkeletonWrapper>
      )}

      <MediaContent $isLoaded={isLoaded}>
        {type === 'video' ? (
          <video src={src} autoPlay loop muted playsInline onLoadedData={handleLoad} />
        ) : (
          <img src={src} alt={alt} onLoad={handleLoad} />
        )}
      </MediaContent>
    </MediaWrapper>
  )
}

const MediaWrapper = styled.div`
  position: relative;
  width: 100%;
  height: 10vw;
  min-height: 120px;
  max-height: 200px;
  border-radius: 0.8vw;
  overflow: hidden;
`

const SkeletonWrapper = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  .ant-skeleton-image {
    width: 100% !important;
    height: 100% !important;
    border-radius: 0.8vw;
  }

  .ant-skeleton-image-svg {
    width: 48px;
    height: 48px;
  }
`

const MediaContent = styled.div<{ $isLoaded: boolean }>`
  position: absolute;
  inset: 0;
  opacity: ${({ $isLoaded }) => ($isLoaded ? 1 : 0)};
  transition: opacity 0.3s ease;

  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 0.8vw;
  }
`

export default LazyMedia
