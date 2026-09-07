import type { FilePreviewPlugin } from '../../types'

export const spreadsheetFilePreviewPlugin = {
  id: 'spreadsheet',
  extensions: ['xlsx'],
  load: () => import('./SpreadsheetFilePreview')
} satisfies FilePreviewPlugin
