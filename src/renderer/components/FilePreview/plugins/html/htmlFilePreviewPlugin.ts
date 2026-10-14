import type { FilePreviewPlugin } from '../../types'

export const htmlFilePreviewPlugin = {
  id: 'html',
  extensions: ['html', 'htm'],
  load: () => import('./HtmlFilePreview')
} satisfies FilePreviewPlugin
