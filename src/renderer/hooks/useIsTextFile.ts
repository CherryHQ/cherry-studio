import { loggerService } from '@logger'
import { joinPath } from '@renderer/utils/path'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useIsTextFile')

export type IsTextState = 'pending' | 'text' | 'binary'

interface UseIsTextFileOptions {
  enabled?: boolean
}

/**
 * Buffer-sniff whether a file is text via the main-side `isbinaryfile` + chardet
 * pipeline (`window.api.file.isTextFile`). Callers that render a known-binary
 * format specially (e.g. PDF or Office documents) can pass `enabled: false` to
 * skip sniffing and receive a synchronous `binary` state.
 */
export function useIsTextFile(
  workspacePath: string | null | undefined,
  filePath: string | null | undefined,
  options?: UseIsTextFileOptions
): IsTextState {
  const [state, setState] = useState<IsTextState>('pending')
  const enabled = options?.enabled ?? true

  useEffect(() => {
    if (!workspacePath || !filePath) {
      setState('pending')
      return
    }

    if (!enabled) {
      setState('binary')
      return
    }

    setState('pending')
    const absPath = joinPath(workspacePath, filePath)
    let cancelled = false

    void (async () => {
      try {
        const isText = await window.api.file.isTextFile(absPath)
        if (!cancelled) setState(isText ? 'text' : 'binary')
      } catch (err) {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to detect text file: ${absPath}`, normalized)
        setState('binary')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, filePath, workspacePath])

  return state
}
