import { imageExts } from '@shared/utils/file'

import type { FilePreviewPlugin } from '../../types'

export const imageFilePreviewPlugin = {
  id: 'image',
  // `.svg`/`.svgz` stay out of the shared imageExts catalog so text-only
  // agents keep reading SVG sources (see fileExtensions.ts); preview-only here.
  extensions: [...imageExts.map((extension) => extension.slice(1)), 'svg', 'svgz'],
  load: () => import('./ImageFilePreview')
} satisfies FilePreviewPlugin
