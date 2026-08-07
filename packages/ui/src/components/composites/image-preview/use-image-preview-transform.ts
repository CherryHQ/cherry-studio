import * as React from 'react'

import type { ImagePreviewTransform } from './types'

export interface ImagePreviewTransformOptions {
  initialTransform?: Partial<ImagePreviewTransform>
  maxZoom?: number
  minZoom?: number
  zoomStep?: number
}

export type ImagePreviewTransformUpdate =
  | Partial<ImagePreviewTransform>
  | ((current: ImagePreviewTransform) => Partial<ImagePreviewTransform>)

export interface ImagePreviewTransformControls {
  canZoomIn: boolean
  canZoomOut: boolean
  flipHorizontal: () => void
  flipVertical: () => void
  maxZoom: number
  minZoom: number
  reset: () => void
  rotateLeft: () => void
  rotateRight: () => void
  transform: ImagePreviewTransform
  update: (update: ImagePreviewTransformUpdate) => void
  zoomIn: () => void
  zoomOut: () => void
}

const DEFAULT_TRANSFORM: ImagePreviewTransform = {
  flipX: false,
  flipY: false,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  zoom: 1
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const normalizeRotate = (value: number) => ((value % 360) + 360) % 360
const toFiniteNumber = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const normalizeTransform = (
  transform: Partial<ImagePreviewTransform> | undefined,
  minZoom: number,
  maxZoom: number
): ImagePreviewTransform => ({
  flipX: transform?.flipX ?? DEFAULT_TRANSFORM.flipX,
  flipY: transform?.flipY ?? DEFAULT_TRANSFORM.flipY,
  offsetX: toFiniteNumber(transform?.offsetX, DEFAULT_TRANSFORM.offsetX),
  offsetY: toFiniteNumber(transform?.offsetY, DEFAULT_TRANSFORM.offsetY),
  rotation: normalizeRotate(toFiniteNumber(transform?.rotation, DEFAULT_TRANSFORM.rotation)),
  zoom: clamp(toFiniteNumber(transform?.zoom, DEFAULT_TRANSFORM.zoom), minZoom, maxZoom)
})

const transformsEqual = (left: ImagePreviewTransform, right: ImagePreviewTransform) =>
  left.flipX === right.flipX &&
  left.flipY === right.flipY &&
  left.offsetX === right.offsetX &&
  left.offsetY === right.offsetY &&
  left.rotation === right.rotation &&
  left.zoom === right.zoom

export function useImagePreviewTransform({
  initialTransform,
  maxZoom = 5,
  minZoom = 1,
  zoomStep = 0.25
}: ImagePreviewTransformOptions = {}): ImagePreviewTransformControls {
  if (minZoom > maxZoom) {
    throw new Error('useImagePreviewTransform requires minZoom <= maxZoom')
  }

  if (zoomStep <= 0 || !Number.isFinite(zoomStep)) {
    throw new Error('useImagePreviewTransform requires zoomStep > 0')
  }

  const initialValue = React.useMemo(
    () => normalizeTransform(initialTransform, minZoom, maxZoom),
    [initialTransform, maxZoom, minZoom]
  )
  const [transform, setTransform] = React.useState<ImagePreviewTransform>(initialValue)

  const update = React.useCallback(
    (nextUpdate: ImagePreviewTransformUpdate) => {
      setTransform((current) => {
        const patch = typeof nextUpdate === 'function' ? nextUpdate(current) : nextUpdate
        const next = normalizeTransform({ ...current, ...patch }, minZoom, maxZoom)
        return transformsEqual(current, next) ? current : next
      })
    },
    [maxZoom, minZoom]
  )

  const reset = React.useCallback(() => {
    setTransform(initialValue)
  }, [initialValue])

  const zoomIn = React.useCallback(() => {
    update((current) => ({ zoom: current.zoom + zoomStep }))
  }, [update, zoomStep])

  const zoomOut = React.useCallback(() => {
    update((current) => ({ zoom: current.zoom - zoomStep }))
  }, [update, zoomStep])

  const rotateLeft = React.useCallback(() => {
    update((current) => ({ offsetX: 0, offsetY: 0, rotation: current.rotation - 90 }))
  }, [update])

  const rotateRight = React.useCallback(() => {
    update((current) => ({ offsetX: 0, offsetY: 0, rotation: current.rotation + 90 }))
  }, [update])

  const flipHorizontal = React.useCallback(() => {
    update((current) => ({ flipX: !current.flipX }))
  }, [update])

  const flipVertical = React.useCallback(() => {
    update((current) => ({ flipY: !current.flipY }))
  }, [update])

  return {
    canZoomIn: transform.zoom < maxZoom,
    canZoomOut: transform.zoom > minZoom,
    flipHorizontal,
    flipVertical,
    maxZoom,
    minZoom,
    reset,
    rotateLeft,
    rotateRight,
    transform,
    update,
    zoomIn,
    zoomOut
  }
}
