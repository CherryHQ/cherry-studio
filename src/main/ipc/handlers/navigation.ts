import { application } from '@application'
import { loggerService } from '@logger'
import {
  acknowledgeMainWindowNavigation,
  isAllowedRoute,
  openRouteInMainWindow
} from '@main/services/mainWindowNavigation'
import type { navigationRequestSchemas } from '@shared/ipc/schemas/navigation'
import type { IpcHandlersFor } from '@shared/ipc/types'

const logger = loggerService.withContext('navigationHandlers')

export const navigationHandlers: IpcHandlersFor<typeof navigationRequestSchemas> = {
  'navigation.open_route_in_main': async ({ path }) => {
    if (!isAllowedRoute(path)) {
      logger.warn('Blocked navigation to disallowed route', { path })
      return
    }
    openRouteInMainWindow(path)
  },
  'navigation.protocol_dispatch_ready': async (_input, { senderId }) => {
    if (senderId) application.get('ProtocolService').onMainRendererReady(senderId)
  },
  'navigation.ack_open_route': async ({ requestId }, { senderId }) => {
    if (senderId) acknowledgeMainWindowNavigation(senderId, requestId)
  },
  'navigation.focus_or_open_conversation': async ({ target, title }, { senderId }) => {
    await application.get('ConversationNavigationService').focusOrOpen(target, title, senderId)
  },
  'navigation.report_conversation_ownership': async ({ requestId, ownsTarget }, { senderId }) => {
    if (!senderId) return
    application.get('ConversationNavigationService').reportOwnership(requestId, senderId, ownsTarget)
  }
}
