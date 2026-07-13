import { net } from 'electron'

import { normalizeStellaEndpoint, stellaConnectionService } from './StellaConnectionService'

const REQUEST_TIMEOUT_MS = 20_000

export interface StellaRemoteAgent {
  id: string
  name: string
  description?: string
  avatar?: string
}

export class StellaClient {
  async testConnection(endpoint: string, pat: string): Promise<{ endpoint: string }> {
    const normalized = normalizeStellaEndpoint(endpoint)
    await this.request(normalized, pat, '/api/agents')
    return { endpoint: normalized }
  }

  async listAgents(): Promise<StellaRemoteAgent[]> {
    const { endpoint, pat } = stellaConnectionService.getCredentials()
    const response = await this.request(endpoint, pat, '/api/agents')
    const body = (await response.json()) as { agents?: unknown }
    if (!Array.isArray(body.agents)) throw new Error('Stella returned an invalid agent list')
    return body.agents.flatMap((agent): StellaRemoteAgent[] => {
      if (!isRecord(agent) || typeof agent.id !== 'string' || typeof agent.name !== 'string') return []
      return [
        {
          id: agent.id,
          name: agent.name,
          ...(typeof agent.description === 'string' ? { description: agent.description } : {}),
          ...(typeof agent.avatar === 'string' ? { avatar: agent.avatar } : {})
        }
      ]
    })
  }

  async createSession(remoteAgentId: string): Promise<string> {
    const { endpoint, pat } = stellaConnectionService.getCredentials()
    const response = await this.request(endpoint, pat, `/api/agents/${encodeURIComponent(remoteAgentId)}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'chat' })
    })
    const body = (await response.json()) as { id?: unknown }
    if (typeof body.id !== 'string' || !body.id) throw new Error('Stella returned an invalid session')
    return body.id
  }

  async sendMessage(remoteAgentId: string, sessionId: string, text: string, signal: AbortSignal): Promise<Response> {
    const { endpoint, pat } = stellaConnectionService.getCredentials()
    return this.request(
      endpoint,
      pat,
      `/api/agents/${encodeURIComponent(remoteAgentId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: 'POST',
        headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text }] }),
        signal
      }
    )
  }

  private async request(endpoint: string, pat: string, pathname: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(pathname, `${endpoint}/`)
    const configured = new URL(endpoint)
    if (url.origin !== configured.origin)
      throw new Error('Stella request origin does not match the configured endpoint')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const relayAbort = () => controller.abort()
    init.signal?.addEventListener('abort', relayAbort, { once: true })
    try {
      // Electron's network stack follows the OS trust store (including local development CAs);
      // Node's global fetch uses a separate CA bundle and rejects otherwise-valid Stella endpoints.
      const response = await net.fetch(url.toString(), {
        ...init,
        signal: controller.signal,
        redirect: 'manual',
        headers: { authorization: `Bearer ${pat}`, ...init.headers }
      })
      // Manual redirecting guarantees Bearer never follows a cross-origin Location.
      if (response.status >= 300 && response.status < 400) throw new Error('Stella endpoint redirected the request')
      if (!response.ok) throw new Error(`Stella request failed (${response.status})`)
      return response
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Stella request timed out or was cancelled')
      throw error instanceof Error && error.message.startsWith('Stella ')
        ? error
        : new Error(`Could not connect to Stella at ${configured.origin}`)
    } finally {
      clearTimeout(timeout)
      init.signal?.removeEventListener('abort', relayAbort)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export const stellaClient = new StellaClient()
