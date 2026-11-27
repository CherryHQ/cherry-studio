import { agentSessionService } from '@data/services/AgentSessionService'

import { BrowserGuestRegistry, type BrowserGuestTarget, type BrowserGuestContext } from './BrowserGuestRegistry'

export interface AgentBrowserContext {
  agentId: string
  sessionId: string
}

export type AgentBrowserTarget = BrowserGuestTarget

export class AgentBrowserRegistry extends BrowserGuestRegistry {
  constructor(claims?: Map<Electron.WebContents, BrowserGuestTarget>) {
    super((id) => agentSessionService.getById(id).agentId ?? '', 'agent', claims)
  }

  override get(context: AgentBrowserContext | BrowserGuestContext, tabId?: string) {
    return super.get('agentId' in context ? { ownerId: context.agentId, sessionId: context.sessionId } : context, tabId)
  }

  override ensureGuest(
    context: AgentBrowserContext | BrowserGuestContext,
    signal: AbortSignal,
    url?: string,
    options?: { pageId?: string; newTab?: boolean }
  ) {
    return super.ensureGuest(
      'agentId' in context ? { ownerId: context.agentId, sessionId: context.sessionId } : context,
      signal,
      url,
      options
    )
  }
}
