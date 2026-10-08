import type { FilePreviewPlugin } from '../../types'

export const imageFilePreviewPlugin = {
  id: 'image',
  extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'avif', 'ico', 'svg'],
  load: () => import('./ImageFilePreview')
} satisfies FilePreviewPlugin
