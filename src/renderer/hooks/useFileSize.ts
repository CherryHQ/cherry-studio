import { loggerService } from '@logger'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useFileSize')

export type FileSizeState = { status: 'pending' } | { status: 'ok'; size: number } | { status: 'error' }

const joinAbsPath = (base: string, rel: string): string => {
  const trimmed = rel.replace(/^[/\\]+/, '')
  return /[/\\]$/.test(base) ? `${base}${trimmed}` : `${base}/${trimmed}`
}

/**
 * Read a file's size via the main-side `file.getFileSize` IPC (thin
 * `fs.stat` wrapper). Used to gate previews above a size threshold before
 * any `readText` is attempted.
 */
export function useFileSize(
  workspacePath: string | null | undefined,
  filePath: string | null | undefined
): FileSizeState {
  const [state, setState] = useState<FileSizeState>({ status: 'pending' })

  useEffect(() => {
    if (!workspacePath || !filePath) {
      setState({ status: 'pending' })
      return
    }

    setState({ status: 'pending' })
    const absPath = joinAbsPath(workspacePath, filePath)
    let cancelled = false

    void (async () => {
      try {
        const size = await window.api.file.getFileSize(absPath)
        if (!cancelled) setState({ status: 'ok', size })
      } catch (err) {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to read file size: ${absPath}`, normalized)
        setState({ status: 'error' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filePath, workspacePath])

  return state
}
