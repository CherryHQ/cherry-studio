import type { FilePreviewPlugin } from '../../types'

export const epubFilePreviewPlugin = {
  id: 'epub',
  extensions: ['epub'],
  load: () => import('./EpubFilePreview')
} satisfies FilePreviewPlugin
