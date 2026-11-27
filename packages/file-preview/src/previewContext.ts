import { createContext, use, useMemo } from 'react'

import type { PreviewDiagnostic, PreviewOptions, PreviewResources } from './types'

export interface PreviewHost {
  root?: HTMLElement | null
  resources?: PreviewResources
  options?: PreviewOptions
  onDiagnostic?: (diagnostic: PreviewDiagnostic) => void
  onRequestOpen?: (reason: 'unsupported' | 'too_large') => void
  failDocument?: (error: unknown) => void
  /** Retained presentation may outlive the document operations that produced it. */
  isCurrentDocument?: () => boolean
  /**
   * Ask the host to re-open the source and hand down a FRESH document (new
   * metadata and revision). Plugins with their own refresh action call this
   * instead of re-reading the retained document, which can only yield fresh
   * bytes — never fresh metadata — and cannot clear a stale `source_changed`.
   */
  onRequestReload?: () => void
}

export const PreviewHostContext = createContext<PreviewHost>({})

export function usePreviewHost(): PreviewHost {
  return use(PreviewHostContext)
}

export function usePreviewLogger(context: string) {
  const { onDiagnostic } = usePreviewHost()
  return useMemo(
    () => ({
      error: (message: string, detail?: unknown, code?: PreviewDiagnostic['code']) =>
        onDiagnostic?.({ code, level: 'error', context, message, detail }),
      warn: (message: string, detail?: unknown) => onDiagnostic?.({ level: 'warn', context, message, detail })
    }),
    [context, onDiagnostic]
  )
}
