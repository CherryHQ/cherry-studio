import { application } from '@application'
import { assistantAvatarService } from '@main/services/AssistantAvatarService'
import type { assistantRequestSchemas } from '@shared/ipc/schemas/assistant'
import type { IpcHandlersFor } from '@shared/ipc/types'

let defaultMcpWrite = Promise.resolve()

export const assistantHandlers: IpcHandlersFor<typeof assistantRequestSchemas> = {
  'assistant.toggle_default_mcp': (input) => {
    const result = defaultMcpWrite.then(async () => {
      const preferences = application.get('PreferenceService')
      const current = preferences.get('assistant.default_mcp_server_ids')
      const next = input.enabled
        ? [...new Set([...current, input.serverId])]
        : current.filter((id) => id !== input.serverId)
      await preferences.set('assistant.default_mcp_server_ids', next)
      return next
    })
    defaultMcpWrite = result.then(
      () => undefined,
      () => undefined
    )
    return result
  },
  'assistant.set_avatar': (input) => assistantAvatarService.apply(input)
}
