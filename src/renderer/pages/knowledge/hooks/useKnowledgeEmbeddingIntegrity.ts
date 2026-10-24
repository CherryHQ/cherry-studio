import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

import { normalizeKnowledgeError } from '../utils/error'

const logger = loggerService.withContext('useKnowledgeEmbeddingIntegrity')

export function useKnowledgeEmbeddingIntegrity(baseId: string, navigationVersion: number): void {
  const invalidateCache = useInvalidateCache()
  const { t } = useTranslation()

  useEffect(() => {
    if (!baseId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      let refresh = false
      try {
        const result = await ipcApi.request('knowledge.check_embedding_integrity', { baseId })
        refresh = result.changedCount > 0
        if (!disposed && result.status === 'deferred') timer = setTimeout(() => void check(), 2000)
      } catch (error) {
        refresh = true
        logger.error('Knowledge embedding integrity check failed', normalizeKnowledgeError(error), { baseId })
        if (!disposed) toast.error(t('knowledge.error.embedding_integrity_check_failed'))
      } finally {
        if (refresh) {
          try {
            await invalidateCache([`/knowledge-bases/${baseId}/items`, '/knowledge-bases'])
          } catch (error) {
            logger.error('Failed to refresh knowledge integrity results', normalizeKnowledgeError(error), { baseId })
          }
        }
      }
    }
    void check()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [baseId, navigationVersion, invalidateCache, t])
}
