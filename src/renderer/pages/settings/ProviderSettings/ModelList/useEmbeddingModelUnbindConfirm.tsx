import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import ConfirmActionPopup from '@renderer/components/popups/ConfirmActionPopup'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { KnowledgeBaseEmbeddingModelUsage } from '@shared/data/api/schemas/knowledges'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { getModelOperationErrorMessage } from './errorMessage'

const logger = loggerService.withContext('EmbeddingModelUnbindConfirm')

/**
 * Delete the models, having already released whatever knowledge bases referenced them.
 * Callers keep owning their own optimistic state and skip rules — this hook only decides
 * *whether* the deletion may start, never *how* it runs.
 */
export type ConfirmEmbeddingModelUnbind = (
  modelIds: UniqueModelId[],
  deleteModels: () => Promise<void>
) => Promise<void>

async function listAffectedBases(modelIds: UniqueModelId[]): Promise<KnowledgeBaseEmbeddingModelUsage[]> {
  const perModel = await Promise.all(
    modelIds.map((embeddingModelId) =>
      ipcApi.request('knowledge.list_bases_using_embedding_model', { embeddingModelId })
    )
  )

  // A base has at most one embedding model, so the lists cannot actually overlap; dedupe
  // anyway so a duplicated id in `modelIds` can never double-list a base to the user.
  const byBaseId = new Map(perModel.flat().map((base) => [base.id, base]))
  return [...byBaseId.values()]
}

const AffectedBasesContent = ({ bases }: { bases: KnowledgeBaseEmbeddingModelUsage[] }) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2">
      <p>{t('settings.models.manage.unbind_knowledge_base.description')}</p>
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {bases.map((base) => (
          <li key={base.id} className="flex flex-col">
            <span className="truncate text-foreground">
              {t('settings.models.manage.unbind_knowledge_base.base_entry', {
                name: base.name,
                count: base.itemCount
              })}
            </span>
            {base.status === 'failed' ? (
              <span className="text-xs">{t('settings.models.manage.unbind_knowledge_base.failed_base_note')}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Gate a model deletion on releasing the knowledge bases that reference it.
 *
 * A knowledge base holds a foreign key on its embedding model, so deleting one that is
 * still referenced fails at the database. Rather than surface that as a dead end, ask for
 * consent and then downgrade those bases to BM25-only retrieval — their vectors become
 * unreadable the moment the model is gone, so they are dropped rather than left behind as
 * bytes nothing can ever use again.
 *
 * With no base affected the deletion runs straight through: adding a confirmation step to
 * the ordinary case would be a regression, not a safeguard.
 *
 * Deliberately does *not* own the deletion itself. Each caller passes its own `deleteModels`
 * so its optimistic row-hiding stays wrapped around the real request — hoisting that above
 * this dialog would leave a row invisible forever when the user cancels.
 */
export function useEmbeddingModelUnbindConfirm(): ConfirmEmbeddingModelUnbind {
  const { t } = useTranslation()
  const invalidateCache = useInvalidateCache()

  return useCallback(
    async (modelIds, deleteModels) => {
      const affectedBases = await listAffectedBases(modelIds)

      if (affectedBases.length === 0) {
        await deleteModels()
        return
      }

      await ConfirmActionPopup.show({
        title: t('settings.models.manage.unbind_knowledge_base.title'),
        content: <AffectedBasesContent bases={affectedBases} />,
        danger: true,
        action: async () => {
          const failedBases: { id: string; name: string; reason: string }[] = []
          let vectorCleanupFailedCount = 0

          // Serial: each unbind already serializes over its own bases, and running them
          // concurrently would only interleave main-process SQLite work.
          for (const embeddingModelId of modelIds) {
            const result = await ipcApi.request('knowledge.unbind_embedding_model', { embeddingModelId })
            failedBases.push(...result.failedBases)
            vectorCleanupFailedCount += result.vectorCleanupFailedBaseIds.length
          }

          // Refresh before the outcome checks: whatever was unbound is already committed,
          // so the UI must reflect it even when the rest of this action bails out.
          await invalidateCache([
            ...affectedBases.map((base) => `/knowledge-bases/${base.id}/items`),
            '/knowledge-bases'
          ])

          if (failedBases.length > 0) {
            logger.error('Failed to release knowledge bases before deleting an embedding model', { failedBases })
            // Throwing keeps the dialog open and retryable — unbinding is idempotent, so a
            // second attempt only re-does the bases that are still bound.
            throw new Error(
              t('settings.models.manage.unbind_knowledge_base.unbind_failed', {
                names: failedBases.map((base) => base.name).join(', ')
              })
            )
          }

          if (vectorCleanupFailedCount > 0) {
            // The model reference is released, so the deletion goes ahead; only dead bytes
            // are left behind.
            toast.warning(
              t('settings.models.manage.unbind_knowledge_base.vector_cleanup_failed', {
                count: vectorCleanupFailedCount
              })
            )
          }

          try {
            await deleteModels()
          } catch (error) {
            // The bases are already downgraded and cannot be put back — say so, instead of
            // letting a bare "delete failed" imply nothing happened.
            throw new Error(
              t('settings.models.manage.unbind_knowledge_base.unbound_but_delete_failed', {
                reason: getModelOperationErrorMessage(error, {
                  fallback: t('settings.models.manage.operation_failed'),
                  modelInUseByKnowledgeBase: t('settings.models.manage.model_in_use_by_knowledge_base'),
                  modelInUseAsDefault: t('settings.models.manage.sync_apply_default_in_use')
                })
              })
            )
          }
        }
      })
    },
    [invalidateCache, t]
  )
}
