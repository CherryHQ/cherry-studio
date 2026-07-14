import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { joinPath } from '@renderer/utils/path'
import type { FilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useIsTextFile')

export type IsTextState = 'pending' | 'text' | 'binary'

interface UseIsTextFileOptions {
  enabled?: boolean
}

/**
 * Whether a file resolves to text, via the `file.get_metadata` IpcApi route —
 * which derives the type by extension and, for extension-unknown files, a main-side
 * `isbinaryfile` + chardet content sniff. Callers that render a known-binary
 * format specially (e.g. PDF or Office documents) can pass `enabled: false` to
 * skip the check and receive a synchronous `binary` state.
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
        const meta = await ipcApi.request('file.get_metadata', createFilePathHandle(absPath as FilePath))
        const isText = meta?.kind === 'file' && meta.type === 'text'
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
