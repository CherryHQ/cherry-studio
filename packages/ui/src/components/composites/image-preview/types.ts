import type * as React from 'react'

export interface ImagePreviewItem {
  id: string
  src: string
  alt?: string
  title?: string
  metadata?: unknown
}

export interface ImagePreviewTransform {
  flipX: boolean
  flipY: boolean
  zoom: number
  rotation: number
  offsetX: number
  offsetY: number
}

export interface ImagePreviewLabels {
  close: string
  flipHorizontal: string
  flipVertical: string
  next: string
  previous: string
  reset: string
  rotateLeft: string
  rotateRight: string
  zoomIn: string
  zoomOut: string
  dialogTitle?: string
}

export interface ImagePreviewActionContext {
  close: () => void
  index: number
  items: ImagePreviewItem[]
  resetTransform: () => void
  transform: ImagePreviewTransform
}

export interface ImagePreviewAction {
  id: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  onSelect: (item: ImagePreviewItem, context: ImagePreviewActionContext) => void | Promise<void>
}

export type ImagePreviewActionErrorHandler = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Toolbar and context-menu actions forward onSelect throws and rejections unchanged, together with the action and item that failed.
  error: unknown,
  action: ImagePreviewAction,
  item: ImagePreviewItem
) => void

export const DEFAULT_IMAGE_PREVIEW_LABELS: ImagePreviewLabels = {
  close: 'Close',
  flipHorizontal: 'Flip horizontal',
  flipVertical: 'Flip vertical',
  next: 'Next image',
  previous: 'Previous image',
  reset: 'Reset',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out'
}
