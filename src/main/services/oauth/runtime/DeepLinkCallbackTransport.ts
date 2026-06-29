import { application } from '@application'
import type { WindowId } from '@shared/ipc/types'

import { OAuthServiceError } from '../errors'
import type { DeepLinkCallbackConfig } from './types'

interface PendingDeepLinkFlow {
  codeVerifier: string
  initiatorWindowId: WindowId
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
  initiatorWindowId: WindowId
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
    initiatorWindowId: WindowId,
    context: PendingDeepLinkFlow['context'] = {}
  ): DeepLinkAuthorizationRequest {
    this.cleanupExpiredFlows()

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

  sendConsumedResult(state: string, initiatorWindowId: WindowId, result: { apiKeys?: string; error?: string }): void {
    this.sendToInitiator(initiatorWindowId, state, result)
  }

  // Point-to-point to the flow's initiator only — the result carries the user's
  // API keys, so it must never broadcast. `IpcApiService.send` no-ops if the
  // window is gone/destroyed.
  private sendToInitiator(windowId: WindowId, state: string, result: { apiKeys?: string; error?: string }): void {
    const payload =
      'error' in result && result.error !== undefined
        ? { state, error: result.error }
        : { state, apiKeys: result.apiKeys ?? '' }
    application.get('IpcApiService').send(windowId, 'cherryin.oauth_result', payload)
  }

  getInitiatorWindowId(state: string): WindowId | null {
    return this.pendingFlows.get(state)?.initiatorWindowId ?? null
  }
}
