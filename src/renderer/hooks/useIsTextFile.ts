import { loggerService } from '@logger'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useIsTextFile')

export type IsTextState = 'pending' | 'text' | 'binary'

const joinAbsPath = (base: string, rel: string): string => {
  const trimmed = rel.replace(/^[/\\]+/, '')
  return /[/\\]$/.test(base) ? `${base}${trimmed}` : `${base}/${trimmed}`
}

/**
 * Buffer-sniff whether a file is text via the main-side `isbinaryfile` + chardet
 * pipeline (`window.api.file.isTextFile`). No extension whitelist — every file
 * goes through the sniff. Callers that render a known-binary format specially
 * (e.g. PDF) should branch on the filename synchronously before consulting
 * this state, since the IPC settles a tick later.
 */
export function useIsTextFile(
  workspacePath: string | null | undefined,
  filePath: string | null | undefined
): IsTextState {
  const [state, setState] = useState<IsTextState>('pending')

  useEffect(() => {
    if (!workspacePath || !filePath) {
      setState('pending')
      return
    }

    setState('pending')
    const absPath = joinAbsPath(workspacePath, filePath)
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
  }, [filePath, workspacePath])

  return state
}
