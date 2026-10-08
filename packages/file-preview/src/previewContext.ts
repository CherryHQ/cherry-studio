import { createContext, use, useMemo } from 'react'

import type { PreviewDiagnostic, PreviewOptions, PreviewResources } from './types'

export interface PreviewHost {
  resources?: PreviewResources
  options?: PreviewOptions
  onDiagnostic?: (diagnostic: PreviewDiagnostic) => void
  onRequestOpen?: (reason: 'unsupported' | 'too_large') => void
  failDocument?: (error: unknown) => void
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
