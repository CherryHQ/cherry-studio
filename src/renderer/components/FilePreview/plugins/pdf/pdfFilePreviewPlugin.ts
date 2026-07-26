import type { FilePreviewPlugin } from '../../types'

export const pdfFilePreviewPlugin = {
  id: 'pdf',
  extensions: ['pdf'],
  load: () => import('./PdfFilePreview')
} satisfies FilePreviewPlugin
