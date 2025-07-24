import { ArrowDownRight, ImageOff, LoaderCircle } from 'lucide-react'
import { UploadTask } from 'prosekit/extensions/file'
import type { ImageAttrs } from 'prosekit/extensions/image'
import type { ReactNodeViewProps } from 'prosekit/react'
import { ResizableHandle, ResizableRoot } from 'prosekit/react/resizable'
import { type SyntheticEvent, useEffect, useState } from 'react'
import styled from 'styled-components'

export default function ImageView(props: ReactNodeViewProps) {
  const { setAttrs, node } = props
  const attrs = node.attrs as ImageAttrs
  const url = attrs.src || ''
  const uploading = url.startsWith('blob:')

  const [aspectRatio, setAspectRatio] = useState<number | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!url.startsWith('blob:')) {
      return
    }

    const uploadTask = UploadTask.get<string>(url)
    if (!uploadTask) {
      return
    }

    const abortController = new AbortController()
    void uploadTask.finished
      .then((resultUrl) => {
        if (resultUrl && typeof resultUrl === 'string') {
          if (abortController.signal.aborted) {
            return
          }
          setAttrs({ src: resultUrl })
        } else {
          if (abortController.signal.aborted) {
            return
          }
          setError('Unexpected upload result')
        }
        UploadTask.delete(uploadTask.objectURL)
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return
        }
        setError(String(error))
        UploadTask.delete(uploadTask.objectURL)
      })
    const unsubscribe = uploadTask.subscribeProgress(({ loaded, total }) => {
      if (abortController.signal.aborted) {
        return
      }
      if (total > 0) {
        setProgress(loaded / total)
      }
    })
    return () => {
      unsubscribe()
      abortController.abort()
    }
  }, [url, setAttrs])

  const handleImageLoad = (event: SyntheticEvent) => {
    const img = event.target as HTMLImageElement
    const { naturalWidth, naturalHeight } = img
    const ratio = naturalWidth / naturalHeight
    if (ratio && Number.isFinite(ratio)) {
      setAspectRatio(ratio)
    }
    if (naturalWidth && naturalHeight && (!attrs.width || !attrs.height)) {
      setAttrs({ width: naturalWidth, height: naturalHeight })
    }
  }

  return (
    <StyledResizableRoot
      width={attrs.width ?? undefined}
      height={attrs.height ?? undefined}
      aspectRatio={aspectRatio}
      onResizeEnd={(event) => setAttrs(event.detail)}
      data-selected={props.selected ? '' : undefined}>
      {url && !error && <StyledImage src={url} onLoad={handleImageLoad} />}
      {uploading && !error && (
        <ProgressIndicator>
          <LoaderCircle size={16} />
          <ProgressText>{Math.round(progress * 100)}%</ProgressText>
        </ProgressIndicator>
      )}
      {error && (
        <ErrorContainer>
          <ImageOff size={32} />
          <ErrorText>Failed to upload image</ErrorText>
        </ErrorContainer>
      )}
      <StyledResizableHandle position="bottom-right">
        <ArrowDownRight size={16} />
      </StyledResizableHandle>
    </StyledResizableRoot>
  )
}

const StyledResizableRoot = styled(ResizableRoot)`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  overflow: hidden;
  margin: 0.5rem 0;
  max-height: 600px;
  max-width: 100%;
  min-height: 64px;
  min-width: 64px;
  outline: 2px solid transparent;
  outline-style: solid;

  &[data-selected] {
    outline-color: rgb(59 130 246);
  }
`

const StyledImage = styled.img`
  height: 100%;
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
`

const ProgressIndicator = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  margin: 0.25rem;
  display: flex;
  align-content: center;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.25rem;
  background-color: rgba(31, 41, 55, 0.6);
  padding: 0.375rem;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.8);
  transition: all 0.15s ease-in-out;

  svg {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`

const ProgressText = styled.div``

const ErrorContainer = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background-color: var(--color-background-soft);
  padding: 0.5rem;
  font-size: 0.875rem;
`

const ErrorText = styled.div`
  opacity: 0.8;

  @media (max-width: 320px) {
    display: none;
  }

  @media (min-width: 321px) {
    display: block;
  }
`

const StyledResizableHandle = styled(ResizableHandle)`
  position: absolute;
  bottom: 0;
  right: 0;
  border-radius: 0.25rem;
  margin: 0.375rem;
  padding: 0.25rem;
  transition: all 0.15s ease-in-out;
  background-color: rgba(17, 24, 39, 0.3);
  color: rgba(255, 255, 255, 0.5);
  opacity: 0;

  &:active {
    background-color: rgba(31, 41, 55, 0.6);
    color: rgba(255, 255, 255, 0.8);
    transform: translate(0.125rem, 0.125rem);
  }

  &:hover {
    background-color: rgba(31, 41, 55, 0.6);
    opacity: 1;
  }

  ${StyledResizableRoot}:hover & {
    opacity: 1;
  }

  ${StyledResizableRoot}[data-resizing] & {
    opacity: 1;
  }
`
