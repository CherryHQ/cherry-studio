import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import type { conversationIslandRequestSchemas } from '@shared/ipc/schemas/conversationIsland'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const conversationIslandHandlers: IpcHandlersFor<typeof conversationIslandRequestSchemas> = {
  'conversation_island.set_expanded': async ({ expanded }, { senderId }) => {
    if (!senderId || application.get('WindowManager').getWindowType(senderId) !== WindowType.ConversationIsland) return

    application.get('ConversationIslandService').setExpanded(expanded)
  }
}
