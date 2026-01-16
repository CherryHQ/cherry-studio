import { ColFlex } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { CreateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildKnowledgeBasePayload } from '../utils/knowledgeBasePayload'

const logger = loggerService.withContext('useUpdateKnowledgeBase')

interface UseUpdateKnowledgeBaseOptions {
  originalBase?: KnowledgeBase
  onSuccess?: (baseId: string) => void
  onError?: (error: Error) => void
}

/**
 * Hook for updating an existing knowledge base
 *
 * Handles critical change detection, migration logic, and update API.
 */
export function useUpdateKnowledgeBase(options: UseUpdateKnowledgeBaseOptions) {
  const { originalBase, onSuccess, onError } = options
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()

  const hasCriticalChanges = useCallback(
    (newBase: KnowledgeBase) => {
      if (!originalBase) {
        return false
      }
      return (
        getModelUniqId(originalBase.model) !== getModelUniqId(newBase.model) ||
        originalBase.dimensions !== newBase.dimensions
      )
    },
    [originalBase]
  )

  const fetchAllItems = useCallback(async (sourceBaseId: string) => {
    const fetchedItems: KnowledgeItemV2[] = []
    let page = 1
    let total = 0

    do {
      const response = (await dataApiService.get(`/knowledge-bases/${sourceBaseId}/items` as any, {
        query: { page, limit: 100 }
      })) as OffsetPaginationResponse<KnowledgeItemV2>
      fetchedItems.push(...response.items)
      total = response.total ?? fetchedItems.length
      page += 1
    } while (fetchedItems.length < total)

    return fetchedItems
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
        const itemsPayload: CreateKnowledgeItemDto[] = sourceItems.map((item) => ({
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

  const submit = useCallback(
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

  const checkHasCriticalChanges = useMemo(() => {
    return (newBase: KnowledgeBase) => hasCriticalChanges(newBase)
  }, [hasCriticalChanges])

  return { submit, loading, hasCriticalChanges: checkHasCriticalChanges }
}
