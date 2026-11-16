import { application } from '@application'
import { t } from '@main/i18n'
import { trackMainProductEvent } from '@main/services/productAnalytics'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'
import type { knowledgeRequestSchemas } from '@shared/ipc/schemas/knowledge'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { isHttpUrl } from '@shared/utils/url'

/**
 * Thin adapters for the knowledge request routes: each one translates a parsed route
 * call into a `KnowledgeService` method (business logic + resource lifecycle stay in
 * that service). These routes act on shared business data, not the caller's window, so
 * they ignore `IpcContext` — there is no `senderId` addressing here (contrast window.ts).
 *
 * Void-output routes use a block body so the arrow resolves `undefined`, matching the
 * route's `z.void()` output (see selection.ts hide_toolbar).
 */
export const knowledgeHandlers: IpcHandlersFor<typeof knowledgeRequestSchemas> = {
  'knowledge.create_base': async ({ base }) => {
    const created = await application.get('KnowledgeService').createBase(base)
    trackMainProductEvent({ event: 'feature_used', feature: 'knowledge', action: 'base_created' })
    return created
  },
  'knowledge.restore_base': async (dto) => application.get('KnowledgeService').restoreBase(dto),
  'knowledge.delete_base': async ({ baseId }) => {
    await application.get('KnowledgeService').deleteBase(baseId)
  },
  'knowledge.add_items': async ({ baseId, items, conflictStrategy }) => {
    if (items.some((item) => item.type === 'url' && !isHttpUrl(item.data.url))) {
      throw new IpcError(knowledgeErrorCodes.INVALID_SOURCE_URL, t('knowledge.source.invalid_url'))
    }
    const result = await application.get('KnowledgeService').addItems(baseId, items, conflictStrategy)
    if (result.status === 'added') {
      trackMainProductEvent({ event: 'feature_used', feature: 'knowledge', action: 'items_added', count: items.length })
    }
    return result
  },
  'knowledge.delete_items': async ({ baseId, itemIds }) => {
    await application.get('KnowledgeService').deleteItems(baseId, itemIds)
  },
  'knowledge.reindex_items': async ({ baseId, itemIds }) => {
    await application.get('KnowledgeService').reindexItems(baseId, itemIds)
  },
  'knowledge.enable_embedding_model': async ({ baseId, patch }) =>
    application.get('KnowledgeService').enableEmbeddingModel(baseId, patch),
  'knowledge.search': async ({ baseId, query }) => {
    const report = (status: 'success' | 'error') =>
      trackMainProductEvent({ event: 'feature_used', feature: 'knowledge', action: 'searched', status })
    try {
      const results = await application.get('KnowledgeService').search(baseId, query)
      report('success')
      return results
    } catch (error) {
      report('error')
      throw error
    }
  },
  'knowledge.get_file_path': async ({ itemId }) => {
    try {
      return application.get('KnowledgeService').getFilePath(itemId)
    } catch (error) {
      if (isDataApiError(error) && (error.code === ErrorCode.NOT_FOUND || error.code === ErrorCode.INVALID_OPERATION)) {
        throw new IpcError(knowledgeErrorCodes.SOURCE_PATH_UNAVAILABLE, 'Knowledge source path is unavailable', {
          cause: error.code
        })
      }
      throw error
    }
  },
  'knowledge.list_item_chunks': async ({ baseId, itemId }) =>
    application.get('KnowledgeService').listItemChunks(baseId, itemId)
}
