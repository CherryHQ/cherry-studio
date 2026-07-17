import type { FilePreviewPlugin } from '../../types'

export const powerPointFilePreviewPlugin = {
  id: 'powerpoint',
  extensions: ['pptx'],
  load: () => import('./PowerPointFilePreview')
} satisfies FilePreviewPlugin
