import { useEffect, useRef } from 'react'

import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'

const logger = loggerService.withContext('useMediaPreAnalysis')

/**
 * Starts the free local analysis of each newly attached audio/video file, so sending it only adds
 * the vision calls. A removed attachment's pass is left to finish: the send may be waiting on it.
 */
export function useMediaPreAnalysis(files: readonly ComposerAttachment[]): void {
  const requested = useRef(new Set<string>())

  useEffect(() => {
    for (const file of files) {
      if (file.type !== FILE_TYPE.VIDEO && file.type !== FILE_TYPE.AUDIO) continue
      if (!file.path || requested.current.has(file.fileTokenSourceId)) continue
      requested.current.add(file.fileTokenSourceId)

      const key = `chat.composer.media_preparing.${file.fileTokenSourceId}` as const
      cacheService.set(key, true)
      ipcApi
        .request('file_processing.media.prepare', { path: file.path })
        // The send reports a real analysis failure; this pass is only a head start.
        .catch((error: unknown) => logger.debug('Media pre-analysis request failed', { error }))
        .finally(() => cacheService.delete(key))
    }
  }, [files])
}
