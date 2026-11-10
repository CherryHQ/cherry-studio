import { application } from '@application'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { sideChatErrorCodes } from '@shared/ipc/errors/sideChat'
import type { sideChatRequestSchemas } from '@shared/ipc/schemas/sideChat'
import type { IpcHandlersFor } from '@shared/ipc/types'

function runtime(senderId: string | null) {
  if (!senderId) throw new IpcError(sideChatErrorCodes.WINDOW_REQUIRED)
  return { service: application.get('SideChatRuntimeService'), windowId: senderId }
}

export const sideChatHandlers: IpcHandlersFor<typeof sideChatRequestSchemas> = {
  'side_chat.create': async ({ source, config }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.create(windowId, source, config)
  },
  'side_chat.get': async ({ topicId }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.get(windowId, topicId)
  },
  'side_chat.list': async ({ sourceTopicId }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.list(windowId, sourceTopicId)
  },
  'side_chat.configure': async ({ topicId, config }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.configure(windowId, topicId, config)
  },
  'side_chat.submit': async ({ topicId, text, modelId }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.submit(windowId, topicId, text, modelId)
  },
  'side_chat.retry': async ({ topicId, questionId, modelId }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.retry(windowId, topicId, questionId, modelId)
  },
  'side_chat.delete_question': async ({ topicId, questionId }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.deleteQuestion(windowId, topicId, questionId)
  },
  'side_chat.stop': async ({ topicId }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.stop(windowId, topicId)
  },
  'side_chat.close': async ({ topicId }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.close(windowId, topicId)
  },
  'side_chat.delete': async ({ topicId }, { senderId }) => {
    const { service, windowId } = runtime(senderId)
    return service.delete(windowId, topicId)
  }
}
