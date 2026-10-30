import type { FilePreviewPlugin } from '../../types'

export const mermaidFilePreviewPlugin = {
  id: 'mermaid',
  extensions: ['mmd', 'mermaid'],
  load: () => import('./MermaidFilePreview')
} satisfies FilePreviewPlugin
