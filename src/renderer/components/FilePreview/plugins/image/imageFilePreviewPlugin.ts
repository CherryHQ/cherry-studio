import { imageExts } from '@shared/utils/file'

import type { FilePreviewPlugin } from '../../types'

export const imageFilePreviewPlugin = {
  id: 'image',
  extensions: imageExts.map((extension) => extension.slice(1)),
  load: () => import('./ImageFilePreview')
} satisfies FilePreviewPlugin
