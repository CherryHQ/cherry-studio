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
  transform: ImagePreviewTransform
  update: (patch: Partial<ImagePreviewTransform>) => void
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
const normalizeRotate = (value: number) => ((value % 360) + 360) % 360
const toFiniteNumber = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const normalizeTransform = (
  transform: Partial<ImagePreviewTransform> | undefined,
  minScale: number,
  maxScale: number
): ImagePreviewTransform => ({
  flipX: transform?.flipX ?? DEFAULT_TRANSFORM.flipX,
  flipY: transform?.flipY ?? DEFAULT_TRANSFORM.flipY,
  rotate: normalizeRotate(toFiniteNumber(transform?.rotate, DEFAULT_TRANSFORM.rotate)),
  scale: clamp(toFiniteNumber(transform?.scale, DEFAULT_TRANSFORM.scale), minScale, maxScale)
})

export function useImagePreviewTransform({
  initialTransform,
  maxScale = 5,
  minScale = 1,
  zoomStep = 0.25
}: ImagePreviewTransformOptions = {}): ImagePreviewTransformControls {
  if (minScale > maxScale) {
    throw new Error('useImagePreviewTransform requires minScale <= maxScale')
  }

  if (zoomStep <= 0 || !Number.isFinite(zoomStep)) {
    throw new Error('useImagePreviewTransform requires zoomStep > 0')
  }

  const initialValue = React.useMemo(
    () => normalizeTransform(initialTransform, minScale, maxScale),
    [initialTransform, maxScale, minScale]
  )
  const [transform, setTransform] = React.useState<ImagePreviewTransform>(initialValue)

  const update = React.useCallback(
    (patch: Partial<ImagePreviewTransform>) => {
      setTransform((current) => normalizeTransform({ ...current, ...patch }, minScale, maxScale))
    },
    [maxScale, minScale]
  )

  const reset = React.useCallback(() => {
    setTransform(initialValue)
  }, [initialValue])

  const zoomIn = React.useCallback(() => {
    setTransform((current) => normalizeTransform({ ...current, scale: current.scale + zoomStep }, minScale, maxScale))
  }, [maxScale, minScale, zoomStep])

  const zoomOut = React.useCallback(() => {
    setTransform((current) => normalizeTransform({ ...current, scale: current.scale - zoomStep }, minScale, maxScale))
  }, [maxScale, minScale, zoomStep])

  const rotateLeft = React.useCallback(() => {
    setTransform((current) => normalizeTransform({ ...current, rotate: current.rotate - 90 }, minScale, maxScale))
  }, [maxScale, minScale])

  const rotateRight = React.useCallback(() => {
    setTransform((current) => normalizeTransform({ ...current, rotate: current.rotate + 90 }, minScale, maxScale))
  }, [maxScale, minScale])

  const flipHorizontal = React.useCallback(() => {
    setTransform((current) => normalizeTransform({ ...current, flipX: !current.flipX }, minScale, maxScale))
  }, [maxScale, minScale])

  const flipVertical = React.useCallback(() => {
    setTransform((current) => normalizeTransform({ ...current, flipY: !current.flipY }, minScale, maxScale))
  }, [maxScale, minScale])

  return {
    canZoomIn: transform.scale < maxScale,
    canZoomOut: transform.scale > minScale,
    flipHorizontal,
    flipVertical,
    reset,
    rotateLeft,
    rotateRight,
    transform,
    update,
    zoomIn,
    zoomOut
  }
}
