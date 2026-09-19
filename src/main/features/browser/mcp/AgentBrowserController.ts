import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { BROWSER_TOOL_GROUP } from '@shared/ai/browserTools'

import type { AgentBrowserContext, AgentBrowserRegistry } from '../AgentBrowserRegistry'
import type { BrowserSessionService } from '../BrowserSessionService'
import { BrowserSessionError } from '../session/BrowserSessionError'
import { SessionBrowserController } from './SessionBrowserController'

export class AgentBrowserController extends SessionBrowserController {
  constructor(service: BrowserSessionService, registry: AgentBrowserRegistry, context: AgentBrowserContext) {
    const owner = { ownerId: context.agentId, sessionId: context.sessionId }
    let cursorTurn: string | undefined
    super(service, {
      assertAvailable: () => {
        const agent = agentService.getAgent(context.agentId)
        if (
          !agent ||
          agent.disabledTools?.includes(BROWSER_TOOL_GROUP) ||
          !application.get('PreferenceService').get('app.browser.agent_control.enabled')
        )
          throw new BrowserSessionError('not_allowed')
      },
      get: () => registry.get(owner),
      ensureGuest: (signal, url) => registry.ensureGuest(owner, signal, url),
      reveal: (target) =>
        application.get('IpcApiService').send(target.windowId, 'browser.pane.open_requested', {
          sessionId: context.sessionId
        }),
      cursorMoved: () => {
        cursorTurn = application.get('AgentSessionRuntimeService').getLiveAssistantMessageId(context.sessionId)
      },
      trackCursor: (hide) => {
        const runtime = application.get('AgentSessionRuntimeService')
        return runtime.onTurnTerminal((event) => {
          if (event.sessionId === context.sessionId && event.assistantMessageId === cursorTurn) hide()
        })
      }
    })
  }
}
