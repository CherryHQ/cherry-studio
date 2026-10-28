import type { FilePreviewPlugin } from '../../types'

export const heifFilePreviewPlugin = {
  id: 'heif',
  extensions: ['heic', 'heif'],
  load: () => import('./HeifFilePreview')
} satisfies FilePreviewPlugin
