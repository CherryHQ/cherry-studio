import { loggerService } from '@logger'
import { joinPath } from '@renderer/utils/path'
import type { FilePath } from '@shared/types/file/common'
import { createFilePathHandle } from '@shared/utils/file/handle'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useFileSize')

export type FileSizeState = { status: 'pending' } | { status: 'ok'; size: number } | { status: 'error' }

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
    const absPath = joinPath(workspacePath, filePath)
    let cancelled = false

    void (async () => {
      try {
        const metadata = await window.api.file.getMetadata(createFilePathHandle(absPath as FilePath))
        if (!cancelled) setState({ status: 'ok', size: metadata.size })
      } catch (err) {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to read file metadata: ${absPath}`, normalized)
        setState({ status: 'error' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filePath, workspacePath])

  return state
}
