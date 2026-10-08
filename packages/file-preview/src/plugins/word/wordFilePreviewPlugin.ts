import type { FilePreviewPlugin } from '../../types'

export const wordFilePreviewPlugin = {
  id: 'word',
  extensions: ['docx'],
  mediaTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  load: () => import('./WordFilePreview'),
  supportsSelectionReference: true
} satisfies FilePreviewPlugin
