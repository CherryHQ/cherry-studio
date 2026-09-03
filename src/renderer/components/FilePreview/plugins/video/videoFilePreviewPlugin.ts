import type { FilePreviewPlugin } from '../../types'

export const VIDEO_FILE_PREVIEW_EXTENSIONS = ['mp4', 'webm', 'm4v'] as const

export const videoFilePreviewPlugin = {
  id: 'video',
  extensions: VIDEO_FILE_PREVIEW_EXTENSIONS,
  load: () => import('./VideoFilePreview')
} satisfies FilePreviewPlugin
