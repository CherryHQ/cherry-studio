import { loggerService } from '@logger'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeQueueStatus } from '@renderer/data/hooks/useKnowledges'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useKnowledgeQueueActions')

export const useKnowledgeQueueActions = (baseId: string) => {
  const { t } = useTranslation()

  const { hasOrphans, orphanCount, refetch: refetchQueue } = useKnowledgeQueueStatus(baseId)

  const { trigger: recoverOrphans, isLoading: isRecovering } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/queue/recover`,
    {
      refresh: [`/knowledge-bases/${baseId}/items`]
    }
  )

  const { trigger: ignoreOrphans, isLoading: isIgnoring } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/queue/ignore`,
    {
      refresh: [`/knowledge-bases/${baseId}/items`]
    }
  )

  const handleRecover = useCallback(async () => {
    try {
      await recoverOrphans({})
      refetchQueue()
    } catch (error) {
      window.toast.error(t('knowledge.orphan_recover_failed'))
      logger.error('Recover orphans failed:', error as Error)
    }
  }, [recoverOrphans, refetchQueue, t])

  const handleIgnore = useCallback(async () => {
    try {
      await ignoreOrphans({})
      refetchQueue()
    } catch (error) {
      window.toast.error(t('knowledge.orphan_ignore_failed'))
      logger.error('Ignore orphans failed:', error as Error)
    }
  }, [ignoreOrphans, refetchQueue, t])

  return {
    hasOrphans,
    orphanCount,
    handleRecover,
    handleIgnore,
    isRecovering,
    isIgnoring
  }
}
