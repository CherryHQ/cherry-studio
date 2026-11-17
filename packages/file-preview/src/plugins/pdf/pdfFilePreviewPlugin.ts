import type { FilePreviewPlugin } from '../../types'

export const pdfFilePreviewPlugin = {
  id: 'pdf',
  extensions: ['pdf'],
  mediaTypes: ['application/pdf'],
  load: () => import('./PdfFilePreview'),
  supportsSelectionReference: true
} satisfies FilePreviewPlugin
