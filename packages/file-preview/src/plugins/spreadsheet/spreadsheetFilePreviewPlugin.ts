import type { FilePreviewPlugin } from '../../types'

export const spreadsheetFilePreviewPlugin = {
  id: 'spreadsheet',
  extensions: ['xlsx'],
  mediaTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  load: () => import('./SpreadsheetFilePreview'),
  supportsSelectionReference: true
} satisfies FilePreviewPlugin
