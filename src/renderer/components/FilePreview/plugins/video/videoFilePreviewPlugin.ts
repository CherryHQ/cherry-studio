import type { FilePreviewPlugin } from '../../types'

export const videoFilePreviewPlugin = {
  id: 'video',
  extensions: ['mp4', 'webm', 'm4v'],
  load: () => import('./VideoFilePreview')
} satisfies FilePreviewPlugin
