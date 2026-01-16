import { loggerService } from '@logger'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeQueueStatus } from '@renderer/data/hooks/useKnowledges'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useKnowledgeQueueActions')

export const useKnowledgeQueueActions = (baseId?: string) => {
  const { t } = useTranslation()
  const resolvedBaseId = baseId ?? ''

  const {
    hasOrphans,
    orphanCount,
    refetch: refetchQueue
  } = useKnowledgeQueueStatus(resolvedBaseId, {
    enabled: !!baseId
  })

  const { trigger: recoverOrphans, isLoading: isRecovering } = useMutation(
    'POST',
    `/knowledge-bases/${resolvedBaseId}/queue/recover`,
    {
      refresh: [`/knowledge-bases/${resolvedBaseId}/items`]
    }
  )

  const { trigger: ignoreOrphans, isLoading: isIgnoring } = useMutation(
    'POST',
    `/knowledge-bases/${resolvedBaseId}/queue/ignore`,
    {
      refresh: [`/knowledge-bases/${resolvedBaseId}/items`]
    }
  )

  const handleRecover = useCallback(async () => {
    try {
      const result = await recoverOrphans({})
      await refetchQueue()
      window.toast.success(t('knowledge.orphan_recovered', { count: result.recoveredCount }))
    } catch (error) {
      window.toast.error(t('knowledge.orphan_recover_failed'))
      logger.error('Recover orphans failed:', error as Error)
    }
  }, [recoverOrphans, refetchQueue, t])

  const handleIgnore = useCallback(async () => {
    try {
      const result = await ignoreOrphans({})
      await refetchQueue()
      window.toast.info(t('knowledge.orphan_ignored', { count: result.ignoredCount }))
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
