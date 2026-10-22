import type { FilePreviewPlugin } from '../../types'

export const imageFilePreviewPlugin = {
  id: 'image',
  extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'avif', 'ico', 'svg'],
  mediaTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/webp',
    'image/avif',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/svg+xml'
  ],
  load: () => import('./ImageFilePreview')
} satisfies FilePreviewPlugin
