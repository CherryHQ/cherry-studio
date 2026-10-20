import { assistantHandlers } from '@data/api/handlers/assistants'
import { messageHandlers } from '@data/api/handlers/messages'
import { modelHandlers } from '@data/api/handlers/models'
import { providerHandlers } from '@data/api/handlers/providers'
import { topicHandlers } from '@data/api/handlers/topics'
import type { ApiImplementation } from '@shared/data/api/types'

/** Browser `data/api/handlers/apiHandlers`: only the routes whose services run in the Worker. */
export const apiHandlers = {
  ...topicHandlers,
  ...messageHandlers,
  ...providerHandlers,
  ...modelHandlers,
  ...assistantHandlers
} as unknown as ApiImplementation
