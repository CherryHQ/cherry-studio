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

/** Optional host policies. Omitted options preserve the desktop preview's layout and rendering. */
export interface PreviewOptions {
  /** Reserve viewport space (default), or append the inset inside document scrolling content. */
  bottomInset?: 'viewport' | 'content'
  pdf?: {
    /** Defaults to the existing sidebar. Overlay mode does not shrink the page viewport. */
    outlineLayout?: 'panel' | 'overlay'
  }
  docx?: {
    /** Fit tracks container resizing until manual zoom; reset resumes fitting. Defaults to actual size. */
    initialZoom?: 'actual-size' | 'fit-width'
    /** Use Unicode for known Symbol/Wingdings bullets on hosts without those fonts. Set before opening. */
    normalizeSymbolBullets?: boolean
  }
  xlsx?: {
    /** Composite muted headers over an opaque background, including the frozen top-left corner. */
    opaqueHeaders?: boolean
  }
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
