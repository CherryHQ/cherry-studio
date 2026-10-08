import type { ComponentType } from 'react'

import type { PreviewSelection } from './selection'
import type { PreviewDocument, PreviewErrorCode } from './source'

export interface PreviewDiagnostic {
  level: 'error' | 'warn'
  code?: PreviewErrorCode | 'navigation_error'
  context: string
  message: string
  detail?: unknown
}

export interface PreviewResources {
  baseUrl?: string
  /** Creates the module worker for a format; takes precedence over `baseUrl` for workers. */
  createWorker?: (kind: 'pdf' | 'xlsx') => Worker
  readPdfResource?: (kind: 'cmap' | 'standard_font', name: string) => Promise<Uint8Array>
}

export interface FilePreviewPluginProps {
  sourceId: string
  fileName: string
  mediaType?: string
  document: PreviewDocument
  onSelection?: (selection: PreviewSelection | null) => void
}

export interface FilePreviewPlugin {
  id: string
  extensions: readonly string[]
  mediaTypes: readonly string[]
  load: () => Promise<{ default: ComponentType<FilePreviewPluginProps> }>
  supportsSelectionReference?: boolean
}
