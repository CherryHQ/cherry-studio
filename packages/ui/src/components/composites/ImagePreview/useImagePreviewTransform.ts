import * as React from 'react'

import type { ImagePreviewTransform } from './types'

export interface ImagePreviewTransformOptions {
  initialTransform?: Partial<ImagePreviewTransform>
  maxScale?: number
  minScale?: number
  zoomStep?: number
}

export interface ImagePreviewTransformControls {
  canZoomIn: boolean
  canZoomOut: boolean
  flipHorizontal: () => void
  flipVertical: () => void
  reset: () => void
  rotateLeft: () => void
  rotateRight: () => void
  setTransform: React.Dispatch<React.SetStateAction<ImagePreviewTransform>>
  transform: ImagePreviewTransform
  zoomIn: () => void
  zoomOut: () => void
}

const DEFAULT_TRANSFORM: ImagePreviewTransform = {
  flipX: false,
  flipY: false,
  rotate: 0,
  scale: 1
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function useImagePreviewTransform({
  initialTransform,
  maxScale = 5,
  minScale = 1,
  zoomStep = 0.25
}: ImagePreviewTransformOptions = {}): ImagePreviewTransformControls {
  const initialValue = React.useMemo(
    () => ({
      ...DEFAULT_TRANSFORM,
      ...initialTransform,
      scale: clamp(initialTransform?.scale ?? DEFAULT_TRANSFORM.scale, minScale, maxScale)
    }),
    [initialTransform, maxScale, minScale]
  )
  const [transform, setTransform] = React.useState<ImagePreviewTransform>(initialValue)

  const reset = React.useCallback(() => {
    setTransform(initialValue)
  }, [initialValue])

  const zoomIn = React.useCallback(() => {
    setTransform((current) => ({
      ...current,
      scale: clamp(current.scale + zoomStep, minScale, maxScale)
    }))
  }, [maxScale, minScale, zoomStep])

  const zoomOut = React.useCallback(() => {
    setTransform((current) => ({
      ...current,
      scale: clamp(current.scale - zoomStep, minScale, maxScale)
    }))
  }, [maxScale, minScale, zoomStep])

  const rotateLeft = React.useCallback(() => {
    setTransform((current) => ({
      ...current,
      rotate: current.rotate - 90
    }))
  }, [])

  const rotateRight = React.useCallback(() => {
    setTransform((current) => ({
      ...current,
      rotate: current.rotate + 90
    }))
  }, [])

  const flipHorizontal = React.useCallback(() => {
    setTransform((current) => ({
      ...current,
      flipX: !current.flipX
    }))
  }, [])

  const flipVertical = React.useCallback(() => {
    setTransform((current) => ({
      ...current,
      flipY: !current.flipY
    }))
  }, [])

  return {
    canZoomIn: transform.scale < maxScale,
    canZoomOut: transform.scale > minScale,
    flipHorizontal,
    flipVertical,
    reset,
    rotateLeft,
    rotateRight,
    setTransform,
    transform,
    zoomIn,
    zoomOut
  }
}
