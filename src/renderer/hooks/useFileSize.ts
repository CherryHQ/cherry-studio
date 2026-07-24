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
  refreshKey?: number,
  knownSizeBytes?: number
): FileSizeState {
  const fileKey = workspacePath && filePath ? `${workspacePath}\0${filePath}` : null
  const requestKey = fileKey ? `${fileKey}\0${refreshKey ?? ''}` : null
  const [result, setResult] = useState<{ fileKey: string | null; requestKey: string | null; state: FileSizeState }>({
    fileKey: null,
    requestKey: null,
    state: PENDING_FILE_SIZE_STATE
  })

  useEffect(() => {
    if (!requestKey || !workspacePath || !filePath) {
      setResult({ fileKey: null, requestKey: null, state: PENDING_FILE_SIZE_STATE })
      return
    }

    // A same-file refresh is stale-while-revalidate: keep the previous result
    // visible while metadata is re-read. A path change still enters the hard
    // pending state synchronously through the derived return value below.
    setResult((previous) =>
      previous.fileKey === fileKey ? previous : { fileKey, requestKey, state: PENDING_FILE_SIZE_STATE }
    )
    const absPath = joinPath(workspacePath, filePath)
    let cancelled = false

    void (async () => {
      try {
        const metadata = await window.api.file.getMetadata(createFilePathHandle(absPath as FilePath))
        if (!cancelled) setResult({ fileKey, requestKey, state: { status: 'ok', size: metadata.size } })
      } catch (err) {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to read file metadata: ${absPath}`, normalized)
        setResult({ fileKey, requestKey, state: { status: 'error' } })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fileKey, filePath, requestKey, workspacePath])

  if (result.fileKey !== fileKey) return PENDING_FILE_SIZE_STATE
  if (result.requestKey === requestKey) return result.state
  if (knownSizeBytes !== undefined) {
    // A successful snapshot read/write is at least as fresh as the previous
    // metadata result. Prefer the larger value until revalidation settles so
    // neither a saved growth nor an external growth can slip under a size cap.
    const size = result.state.status === 'ok' ? Math.max(result.state.size, knownSizeBytes) : knownSizeBytes
    return { status: 'ok', size }
  }
  return result.state
}
