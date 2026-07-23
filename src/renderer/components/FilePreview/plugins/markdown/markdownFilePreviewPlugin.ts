import type { FilePreviewPlugin } from '../../types'

export const markdownFilePreviewPlugin = {
  id: 'markdown',
  extensions: ['md', 'markdown'],
  load: () => import('./MarkdownFilePreview')
} satisfies FilePreviewPlugin
