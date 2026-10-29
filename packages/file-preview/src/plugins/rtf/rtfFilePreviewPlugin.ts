import type { FilePreviewPlugin } from '../../types'

export const rtfFilePreviewPlugin = {
  id: 'rtf',
  extensions: ['rtf'],
  mediaTypes: ['application/rtf', 'text/rtf', 'application/x-rtf'],
  load: () => import('./RtfFilePreview')
} satisfies FilePreviewPlugin
