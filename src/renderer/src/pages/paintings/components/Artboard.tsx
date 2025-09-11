import ImageViewer from '@renderer/components/ImageViewer'
import FileManager from '@renderer/services/FileManager'
import { Painting } from '@renderer/types'
import { Button, Spin } from 'antd'
import React, { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ArtboardProps {
  painting: Painting
  isLoading: boolean
  currentImageIndex: number
  onPrevImage: () => void
  onNextImage: () => void
  onCancel: () => void
  retry?: (painting: Painting) => void
  imageCover?: React.ReactNode
  loadText?: React.ReactNode
}

const Artboard: FC<ArtboardProps> = ({
  painting,
  isLoading,
  currentImageIndex,
  onPrevImage,
  onNextImage,
  onCancel,
  retry,
  imageCover,
  loadText
}) => {
  const { t } = useTranslation()

  const getCurrentImageUrl = () => {
    const currentFile = painting.files[currentImageIndex]
    return currentFile ? FileManager.getFileUrl(currentFile) : ''
  }

  return (
    <Container>
      <LoadingContainer spinning={isLoading}>
        {painting.files.length > 0 ? (
          <ImageContainer>
            {painting.files.length > 1 && (
              <NavigationButton onClick={onPrevImage} style={{ left: 10 }}>
                ←
              </NavigationButton>
            )}
            <ImageViewer
              src={getCurrentImageUrl()}
              preview={{ mask: false }}
              style={{
                maxWidth: 'var(--artboard-max)',
                maxHeight: 'var(--artboard-max)',
                objectFit: 'contain',
                backgroundColor: 'var(--color-background-soft)',
                cursor: 'pointer'
              }}
            />
            {painting.files.length > 1 && (
              <NavigationButton onClick={onNextImage} style={{ right: 10 }}>
                →
              </NavigationButton>
            )}
            <ImageCounter>
              {currentImageIndex + 1} / {painting.files.length}
            </ImageCounter>
          </ImageContainer>
        ) : (
          <ImagePlaceholder>
            {painting.urls.length > 0 && retry ? (
              <div>
                <ImageList>
                  {painting.urls.map((url, index) => (
                    <ImageListItem key={url || index}>{url}</ImageListItem>
                  ))}
                </ImageList>
                <div>
                  {t('paintings.proxy_required')}
                  <Button type="link" onClick={() => retry?.(painting)}>
                    {t('paintings.image_retry')}
                  </Button>
                </div>
              </div>
            ) : imageCover ? (
              imageCover
            ) : loadText && isLoading ? (
              ''
            ) : (
              <div>{t('paintings.image_placeholder')}</div>
            )}
          </ImagePlaceholder>
        )}
        {isLoading && (
          <LoadingOverlay>
            <Spin size="large" />
            {loadText ? loadText : ''}
            <CancelButton onClick={onCancel}>{t('common.cancel')}</CancelButton>
          </LoadingOverlay>
        )}
      </LoadingContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  justify-content: center;
  align-items: center;

  --artboard-max: calc(100vh - 256px);
`

const ImagePlaceholder = styled.div`
  display: flex;
  width: var(--artboard-max);
  height: var(--artboard-max);
  background-color: var(--color-background-soft);
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
`

const ImageList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  word-break: break-all;
  user-select: text;
`

const ImageListItem = styled.li`
  color: var(--color-text-secondary);
  margin-bottom: 10px;
`

const ImageContainer = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  .ant-spin {
    max-height: none;
  }

  .ant-spin-spinning {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
  }
`

const NavigationButton = styled(Button)`
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  opacity: 0.7;
  &:hover {
    opacity: 1;
  }
`

const ImageCounter = styled.div`
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(0, 0, 0, 0.5);
  color: white;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
`

const LoadingContainer = styled.div<{ spinning: boolean }>`
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  opacity: ${(props) => (props.spinning ? 0.5 : 1)};
  transition: opacity 0.3s;
`

const LoadingOverlay = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
`

const CancelButton = styled(Button)`
  margin-top: 10px;
  z-index: 1001;
`

export default Artboard
