import { application } from '@application'
import { TopicArchiveBusyError } from '@main/services/trash'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { trashErrorCodes } from '@shared/ipc/errors/trash'
import type { trashRequestSchemas } from '@shared/ipc/schemas/trash'
import type { IpcHandlersFor } from '@shared/ipc/types'

async function exposeArchiveError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof TopicArchiveBusyError) {
      throw new IpcError(trashErrorCodes.TRASH_TOPIC_BUSY, error.message, { topicIds: error.topicIds })
    }
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
      throw new IpcError(trashErrorCodes.TRASH_TARGET_NOT_FOUND, error.message)
    }
    throw error
  }
}

/**
 * Thin adapter for the trash request route: delegates to `TrashService`, which
 * owns the purge job. Acts on shared business data, not the caller's window,
 * so it ignores `IpcContext`.
 */
export const trashHandlers: IpcHandlersFor<typeof trashRequestSchemas> = {
  'trash.topic.archive': ({ topicIds }) =>
    exposeArchiveError(() => application.get('TrashService').archiveTopics(topicIds)),
  'trash.assistant_topics.archive': ({ assistantId }) =>
    exposeArchiveError(() => application.get('TrashService').archiveAssistantTopics(assistantId)),
  'trash.assistant.archive': ({ assistantId, deleteTopics }) =>
    exposeArchiveError(() => application.get('TrashService').archiveAssistant(assistantId, deleteTopics)),
  'trash.purge_now': async () => application.get('TrashService').purgeNow()
}
