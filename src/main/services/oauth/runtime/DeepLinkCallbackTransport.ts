import { application } from '@application'
import { IpcChannel } from '@shared/IpcChannel'

import { OAuthServiceError } from '../errors'
import type { DeepLinkCallbackConfig } from './types'

interface PendingDeepLinkFlow {
  codeVerifier: string
  initiatorWindowId: string
  context: {
    oauthServer?: string
    apiHost?: string
  }
  timestamp: number
}

export interface DeepLinkAuthorizationRequest {
  authUrl: string
  state: string
}

export interface DeepLinkAuthorizationCallback {
  state: string
  code: string
  codeVerifier: string
  initiatorWindowId: string
  context: PendingDeepLinkFlow['context']
}

const FLOW_TTL_MS = 10 * 60 * 1000

export class DeepLinkCallbackTransport {
  private readonly pendingFlows = new Map<string, PendingDeepLinkFlow>()

  constructor(private readonly config: DeepLinkCallbackConfig) {}

  get isActive(): boolean {
    return this.pendingFlows.size > 0
  }

  close(): void {
    this.pendingFlows.clear()
  }

  cleanupExpiredFlows(): void {
    const now = Date.now()
    for (const [state, flow] of this.pendingFlows.entries()) {
      if (now - flow.timestamp > FLOW_TTL_MS) {
        this.pendingFlows.delete(state)
      }
    }
  }

  registerAuthorizationRequest(
    authUrl: string,
    state: string,
    codeVerifier: string,
    event: Electron.IpcMainInvokeEvent,
    context: PendingDeepLinkFlow['context'] = {}
  ): DeepLinkAuthorizationRequest {
    this.cleanupExpiredFlows()

    const initiatorWindowId = application.get('WindowManager').getWindowIdByWebContents(event.sender)
    if (!initiatorWindowId) {
      throw new OAuthServiceError('OAuth flow initiator is not a managed window')
    }

    this.pendingFlows.set(state, {
      codeVerifier,
      initiatorWindowId,
      context,
      timestamp: Date.now()
    })

    return { authUrl, state }
  }

  consumeCallback(url: URL): DeepLinkAuthorizationCallback | null {
    if (`${url.protocol}//${url.host}${url.pathname}` !== this.config.redirectUri) {
      return null
    }

    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')

    // A missing/unknown/expired state is not this transport's flow (or a forged
    // CSRF probe). Return null so the dispatcher keeps trying other transports
    // and treats it as a non-event — do NOT throw, which would abort the whole
    // callback dispatch and log a routine rejected probe at error level.
    if (!state) {
      return null
    }

    const flow = this.pendingFlows.get(state)
    if (!flow) {
      return null
    }

    if (Date.now() - flow.timestamp > FLOW_TTL_MS) {
      this.pendingFlows.delete(state)
      return null
    }

    if (error) {
      this.pendingFlows.delete(state)
      throw new OAuthServiceError(url.searchParams.get('error_description') || error)
    }
    if (!code) {
      this.pendingFlows.delete(state)
      throw new OAuthServiceError('No authorization code received')
    }

    this.pendingFlows.delete(state)
    return {
      state,
      code,
      codeVerifier: flow.codeVerifier,
      initiatorWindowId: flow.initiatorWindowId,
      context: flow.context
    }
  }

  sendResult(state: string, result: { apiKeys?: string; error?: string }): void {
    const flow = this.pendingFlows.get(state)
    if (!flow) return
    this.pendingFlows.delete(state)
    this.sendToInitiator(flow.initiatorWindowId, state, result)
  }

  sendConsumedResult(state: string, initiatorWindowId: string, result: { apiKeys?: string; error?: string }): void {
    this.sendToInitiator(initiatorWindowId, state, result)
  }

  private sendToInitiator(windowId: string, state: string, result: { apiKeys?: string; error?: string }): void {
    const window = application.get('WindowManager').getWindow(windowId)
    if (!window || window.isDestroyed()) return
    window.webContents.send(IpcChannel.CherryIN_OAuthResult, { state, ...result })
  }

  getInitiatorWindowId(state: string): string | null {
    return this.pendingFlows.get(state)?.initiatorWindowId ?? null
  }
}
