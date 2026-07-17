import { setAssistantAvatar } from '@main/services/entityAvatar'
import type { assistantRequestSchemas } from '@shared/ipc/schemas/assistant'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const assistantHandlers: IpcHandlersFor<typeof assistantRequestSchemas> = {
  'assistant.set_avatar': async ({ assistantId, avatar }) => setAssistantAvatar(assistantId, avatar)
}
