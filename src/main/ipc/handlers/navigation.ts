import { application } from '@application'
import { loggerService } from '@logger'
import {
  acknowledgeMainWindowNavigation,
  isAllowedRoute,
  markMainRendererReadyForTabAttach,
  openRouteInMainWindow
} from '@main/services/mainWindowNavigation'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
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
  // The main renderer's mount effects have flushed: every useIpcOn listener is
  // registered. Fan out to both consumers (protocol URL dispatch + tab-attach
  // queue flush) — see the handler docs in mainWindowNavigation.ts.
  'navigation.protocol_dispatch_ready': async (_input, { senderId }) => {
    if (senderId) {
      application.get('ProtocolService').onMainRendererReady(senderId)
      markMainRendererReadyForTabAttach(senderId)
    }
  },
  'navigation.ack_open_route': async ({ requestId }, { senderId }) => {
    if (senderId) acknowledgeMainWindowNavigation(senderId, requestId)
  },
  'navigation.focus_or_open_conversation': async ({ target, title, messageId }, { senderId }) => {
    try {
      await application.get('ConversationNavigationService').focusOrOpen(target, title, senderId, messageId)
    } catch (error) {
      if (target.conversationType === 'agent' && isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        throw new IpcError(aiErrorCodes.AI_AGENT_SESSION_NOT_FOUND, error.message)
      }
      throw error
    }
  },
  'navigation.report_conversation_ownership': async ({ requestId, ownsTarget }, { senderId }) => {
    if (!senderId) return
    application.get('ConversationNavigationService').reportOwnership(requestId, senderId, ownsTarget)
  }
}
