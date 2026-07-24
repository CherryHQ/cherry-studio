import { loggerService } from '@logger'
import { joinPath } from '@renderer/utils/path'
import type { FilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useFileSize')

export type FileSizeState = { status: 'pending' } | { status: 'ok'; size: number } | { status: 'error' }

const PENDING_FILE_SIZE_STATE: FileSizeState = { status: 'pending' }

export function useFileSize(
  workspacePath: string | null | undefined,
  filePath: string | null | undefined,
  refreshKey?: number
): FileSizeState {
  const requestKey = workspacePath && filePath ? `${workspacePath}\0${filePath}\0${refreshKey ?? ''}` : null
  const [result, setResult] = useState<{ key: string | null; state: FileSizeState }>({
    key: null,
    state: PENDING_FILE_SIZE_STATE
  })

  useEffect(() => {
    if (!requestKey || !workspacePath || !filePath) {
      setResult({ key: null, state: PENDING_FILE_SIZE_STATE })
      return
    }

    setResult({ key: requestKey, state: PENDING_FILE_SIZE_STATE })
    const absPath = joinPath(workspacePath, filePath)
    let cancelled = false

    void (async () => {
      try {
        const metadata = await window.api.file.getMetadata(createFilePathHandle(absPath as FilePath))
        if (!cancelled) setResult({ key: requestKey, state: { status: 'ok', size: metadata.size } })
      } catch (err) {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to read file metadata: ${absPath}`, normalized)
        setResult({ key: requestKey, state: { status: 'error' } })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filePath, requestKey, workspacePath])

  return result.key === requestKey ? result.state : PENDING_FILE_SIZE_STATE
}
