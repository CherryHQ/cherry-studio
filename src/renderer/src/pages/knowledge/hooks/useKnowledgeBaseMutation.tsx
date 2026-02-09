import { ColFlex } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import AiProviderNew from '@renderer/aiCore/index_new'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { flattenKnowledgeItems, useKnowledgeBases } from '@renderer/data/hooks/useKnowledgeData'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import type { CreateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItemTreeNode } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildKnowledgeBasePayload } from '../utils/knowledgeBasePayload'

const logger = loggerService.withContext('useKnowledgeBaseMutation')

type UseKnowledgeBaseMutationOptions =
  | {
      mode: 'create'
      onSuccess?: (baseId: string) => void
      onError?: (error: Error) => void
    }
  | {
      mode: 'update'
      originalBase: KnowledgeBase
      onSuccess?: (baseId: string) => void
      onError?: (error: Error) => void
    }

/**
 * Unified hook for creating or updating a knowledge base.
 *
 * - `mode: 'create'`: validates name/model, auto-fetches embedding dimensions, calls createKnowledgeBase().
 * - `mode: 'update'`: detects critical changes (model/dimensions), handles migration or simple patch.
 *
 * Returns `{ submit, loading, hasCriticalChanges }`.
 * `hasCriticalChanges` always returns `false` in create mode.
 */
export function useKnowledgeBaseMutation(options: UseKnowledgeBaseMutationOptions) {
  const { mode, onSuccess, onError } = options
  const originalBase = mode === 'update' ? options.originalBase : undefined

  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { createKnowledgeBase } = useKnowledgeBases()
  const invalidate = useInvalidateCache()

  // --- Critical change detection (update mode only) ---

  const hasCriticalChanges = useCallback(
    (newBase: KnowledgeBase) => {
      if (!originalBase) return false
      return (
        getModelUniqId(originalBase.model) !== getModelUniqId(newBase.model) ||
        originalBase.dimensions !== newBase.dimensions
      )
    },
    [originalBase]
  )

  const checkHasCriticalChanges = useMemo(
    () => (newBase: KnowledgeBase) => hasCriticalChanges(newBase),
    [hasCriticalChanges]
  )

  // --- Migration helpers (update mode only) ---

  const fetchAllItems = useCallback(async (sourceBaseId: string) => {
    const response = (await dataApiService.get(
      `/knowledge-bases/${sourceBaseId}/items` as any
    )) as KnowledgeItemTreeNode[]
    return flattenKnowledgeItems(response)
  }, [])

  const migrateBase = useCallback(
    async (sourceBase: KnowledgeBase, targetBase: KnowledgeBase) => {
      const timestamp = dayjs().format('YYMMDDHHmmss')
      const nextName = `${targetBase.name || sourceBase.name}-${timestamp}`
      const payload = buildKnowledgeBasePayload({ ...targetBase, name: nextName })
      const createdBase = await dataApiService.post('/knowledge-bases' as any, {
        body: payload
      })

      const sourceItems = await fetchAllItems(sourceBase.id)
      if (sourceItems.length > 0) {
        const itemsPayload: CreateKnowledgeItemDto[] = sourceItems
          .filter((item) => item.parentId === null || item.parentId === undefined)
          .map((item) => ({
            type: item.type,
            data: item.data
          }))

        await dataApiService.post(`/knowledge-bases/${createdBase.id}/items` as any, {
          body: { items: itemsPayload }
        })
      }

      await invalidate(['/knowledge-bases', `/knowledge-bases/${createdBase.id}`])
      return createdBase.id
    },
    [fetchAllItems, invalidate]
  )

  const handleMigration = useCallback(
    async (newBase: KnowledgeBase) => {
      if (!originalBase) return

      setLoading(true)
      try {
        const migratedBaseId = await migrateBase(originalBase, { ...newBase, id: nanoid() })
        onSuccess?.(migratedBaseId)
      } catch (error) {
        logger.error('KnowledgeBase migration failed:', error as Error)
        window.toast.error(t('knowledge.migrate.error.failed') + ': ' + formatErrorMessage(error))
        onError?.(error as Error)
      } finally {
        setLoading(false)
      }
    },
    [originalBase, migrateBase, onSuccess, onError, t]
  )

  const handleUpdate = useCallback(
    async (newBase: KnowledgeBase) => {
      if (!originalBase) return

      setLoading(true)
      try {
        logger.debug('Updating knowledge base', newBase)
        const payload = buildKnowledgeBasePayload(newBase)
        await dataApiService.patch(`/knowledge-bases/${originalBase.id}` as any, {
          body: payload
        })
        await invalidate(['/knowledge-bases', `/knowledge-bases/${originalBase.id}`])
        onSuccess?.(originalBase.id)
      } catch (error) {
        logger.error('KnowledgeBase edit failed:', error as Error)
        window.toast.error(t('knowledge.error.failed_to_edit') + formatErrorMessage(error))
        onError?.(error as Error)
      } finally {
        setLoading(false)
      }
    },
    [originalBase, invalidate, onSuccess, onError, t]
  )

  // --- Create logic ---

  const submitCreate = useCallback(
    async (newBase: KnowledgeBase) => {
      if (!newBase.name?.trim()) {
        window.toast.error(t('knowledge.name_required'))
        return
      }

      if (!newBase.model) {
        window.toast.error(t('knowledge.embedding_model_required'))
        return
      }

      setLoading(true)

      try {
        let dimensions = newBase.dimensions

        // Auto-fetch dimensions if not manually set
        if (!dimensions) {
          const provider = providers.find((p) => p.id === newBase.model.provider)

          if (!provider) {
            window.toast.error(t('knowledge.provider_not_found'))
            setLoading(false)
            return
          }

          try {
            const aiProvider = new AiProviderNew(provider)
            dimensions = await aiProvider.getEmbeddingDimensions(newBase.model)
            logger.info('Auto-fetched embedding dimensions', { dimensions, modelId: newBase.model.id })
          } catch (error) {
            logger.error('Failed to get embedding dimensions', error as Error)
            window.toast.error(t('message.error.get_embedding_dimensions') + '\n' + formatErrorMessage(error))
            setLoading(false)
            return
          }
        }

        logger.info('Creating knowledge base via Data API', {
          id: newBase.id,
          name: newBase.name,
          modelId: newBase.model?.id,
          provider: newBase.model?.provider,
          dimensions
        })

        const payload = buildKnowledgeBasePayload({ ...newBase, dimensions })
        const newBaseV2 = await createKnowledgeBase(payload)

        onSuccess?.(newBaseV2.id)
      } catch (error) {
        logger.error('KnowledgeBase creation failed:', error as Error)
        window.toast.error(t('knowledge.error.failed_to_create') + formatErrorMessage(error))
        onError?.(error as Error)
      } finally {
        setLoading(false)
      }
    },
    [t, providers, createKnowledgeBase, onSuccess, onError]
  )

  // --- Update logic ---

  const submitUpdate = useCallback(
    async (newBase: KnowledgeBase) => {
      if (!originalBase) return

      if (hasCriticalChanges(newBase)) {
        window.modal.confirm({
          title: t('knowledge.migrate.confirm.title'),
          content: (
            <ColFlex className="items-start">
              <span>{t('knowledge.migrate.confirm.content')}</span>
              <span>{t('knowledge.embedding_model')}:</span>
              <span
                style={{
                  paddingLeft: '1em'
                }}>{`${t('knowledge.migrate.source_model')}: ${originalBase.model.name}`}</span>
              <span
                style={{ paddingLeft: '1em' }}>{`${t('knowledge.migrate.target_model')}: ${newBase.model.name}`}</span>
              <span>{t('knowledge.dimensions')}:</span>
              <span
                style={{
                  paddingLeft: '1em'
                }}>{`${t('knowledge.migrate.source_dimensions')}: ${originalBase.dimensions}`}</span>
              <span
                style={{
                  paddingLeft: '1em'
                }}>{`${t('knowledge.migrate.target_dimensions')}: ${newBase.dimensions}`}</span>
            </ColFlex>
          ),
          okText: t('knowledge.migrate.confirm.ok'),
          centered: true,
          onOk: () => handleMigration(newBase)
        })
      } else {
        await handleUpdate(newBase)
      }
    },
    [originalBase, hasCriticalChanges, handleMigration, handleUpdate, t]
  )

  // --- Public API ---

  const submit = mode === 'create' ? submitCreate : submitUpdate

  return { submit, loading, hasCriticalChanges: checkHasCriticalChanges }
}
