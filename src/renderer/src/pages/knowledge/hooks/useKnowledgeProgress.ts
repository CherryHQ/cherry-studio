import { loggerService } from '@logger'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useKnowledgeProgress')

export const useKnowledgeProgress = () => {
  const [quota, setQuota] = useState<number | undefined>(undefined)
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map())
  const [preprocessMap, setPreprocessMap] = useState<Map<string, boolean>>(new Map())

  useEffect(() => {
    const handlers = [
      window.electron.ipcRenderer.on('file-preprocess-finished', (_, { itemId, quota }) => {
        setPreprocessMap((prev) => new Map(prev).set(itemId, true))
        if (quota) {
          setQuota(quota)
        }
      }),

      window.electron.ipcRenderer.on('file-preprocess-progress', (_, { itemId, progress }) => {
        setProgressMap((prev) => new Map(prev).set(itemId, progress))
      }),

      window.electron.ipcRenderer.on('file-ocr-progress', (_, { itemId, progress }) => {
        setProgressMap((prev) => new Map(prev).set(itemId, progress))
      }),

      window.electron.ipcRenderer.on('directory-processing-percent', (_, { itemId, percent }) => {
        logger.debug('[Progress] Directory:', itemId, percent)
        setProgressMap((prev) => new Map(prev).set(itemId, percent))
      })
    ]

    return () => {
      handlers.forEach((cleanup) => cleanup())
    }
  }, [])

  return { quota, progressMap, preprocessMap }
}
