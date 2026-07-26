import type { FilePreviewPlugin } from '../../types'

export const wordFilePreviewPlugin = {
  id: 'word',
  extensions: ['docx'],
  load: () => import('./WordFilePreview')
} satisfies FilePreviewPlugin
