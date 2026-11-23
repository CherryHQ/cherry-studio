import { createContext, use, useMemo } from 'react'

import type { PreviewDiagnostic, PreviewOptions, PreviewResources } from './types'

export interface PreviewHost {
  root?: HTMLElement | null
  resources?: PreviewResources
  options?: PreviewOptions
  onDiagnostic?: (diagnostic: PreviewDiagnostic) => void
  onRequestOpen?: (reason: 'unsupported' | 'too_large') => void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Format engines and document reads can reject arbitrary values; the session callback wraps them in PreviewError.
  failDocument?: (error: unknown) => void
  /** Retained presentation may outlive the document operations that produced it. */
  isCurrentDocument?: () => boolean
}

export const PreviewHostContext = createContext<PreviewHost>({})

export function usePreviewHost(): PreviewHost {
  return use(PreviewHostContext)
}

export function usePreviewLogger(context: string) {
  const { onDiagnostic } = usePreviewHost()

  return useMemo(
    () => ({
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Engine errors and format-specific diagnostics are opaque host details, forwarded without assuming an Error instance.
      error: (message: string, detail?: unknown, code?: PreviewDiagnostic['code']) =>
        onDiagnostic?.({ code, level: 'error', context, message, detail }),
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Non-terminal engine warnings carry format-specific details; the host owns diagnostic presentation and logging.
      warn: (message: string, detail?: unknown) => onDiagnostic?.({ level: 'warn', context, message, detail })
    }),
    [context, onDiagnostic]
  )
}
