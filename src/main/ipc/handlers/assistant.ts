import { assistantAvatarService } from '@main/services/AssistantAvatarService'
import type { assistantRequestSchemas } from '@shared/ipc/schemas/assistant'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const assistantHandlers: IpcHandlersFor<typeof assistantRequestSchemas> = {
  'assistant.set_avatar': (input) => assistantAvatarService.apply(input)
}
