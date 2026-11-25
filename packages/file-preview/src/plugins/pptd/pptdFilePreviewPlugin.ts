import type { FilePreviewPlugin } from '../../types'

export const pptdFilePreviewPlugin = {
  id: 'pptd',
  extensions: ['pptd'],
  mediaTypes: [],
  load: () => import('./PptdFilePreview'),
  supportsSelectionReference: false
} satisfies FilePreviewPlugin
