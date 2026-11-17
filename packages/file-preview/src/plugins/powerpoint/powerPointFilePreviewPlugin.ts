import type { FilePreviewPlugin } from '../../types'

export const powerPointFilePreviewPlugin = {
  id: 'powerpoint',
  extensions: ['pptx'],
  mediaTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  load: () => import('./PowerPointFilePreview'),
  supportsSelectionReference: true
} satisfies FilePreviewPlugin
