// WebUI远程扩展，仅Win11启用，最小侵入
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { application } from '@application'
import { startAgentSessionRun } from '@main/ai/streamManager/api/startAgentSessionRun'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '@main/ai/streamManager/types'
import { ApiServer } from '@main/data/api'
import type { UniqueModelId } from '@shared/data/types/model'
import type { DataRequest, HttpMethod } from '@shared/data/api/types'
import type { UIMessageChunk } from 'ai'

import type { WebUiSseRelay } from './sseRelay'

export type WebUiApiRouterOptions = {
  readonly getAuthKey: () => string
  readonly getLanguage: () => string | null
  readonly getSseClientCount: () => number
  readonly sseRelay: WebUiSseRelay
}

export type WebUiApiRouter = {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>
}

type WebUiApiRouteResult = {
  readonly status: number
  readonly body?: unknown
}

type WebUiSendMessageBody = {
  readonly text: string
}

const jsonHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8'
}

const authHeaderName = 'x-cherry-webui-key'

export const isWebUiApiRequest = (requestUrl?: string) => {
  if (!requestUrl) return false

  return new URL(requestUrl, 'http://webui.local').pathname.startsWith('/api/')
}

const writeJson = (response: ServerResponse, { status, body }: WebUiApiRouteResult) => {
  response.writeHead(status, jsonHeaders)
  response.end(JSON.stringify(body ?? null))
}

const methodNotAllowed = (allowed: readonly string[]): WebUiApiRouteResult => ({
  status: 405,
  body: {
    code: 'METHOD_NOT_ALLOWED',
    message: `Method not allowed. Allowed methods: ${allowed.join(', ')}`
  }
})

const normalizeAuthKey = (key: string) => key.trim()

export const isWebUiRequestAuthorized = (request: IncomingMessage, url: URL, authKey: string) => {
  const expectedKey = normalizeAuthKey(authKey)
  if (!expectedKey) return true

  const headerValue = request.headers[authHeaderName]
  const providedKey =
    typeof headerValue === 'string'
      ? headerValue
      : Array.isArray(headerValue)
        ? headerValue[0]
        : url.searchParams.get('key')

  return normalizeAuthKey(providedKey ?? '') === expectedKey
}

const unauthorized = (): WebUiApiRouteResult => ({
  status: 401,
  body: {
    code: 'WEBUI_AUTH_REQUIRED',
    message: 'A valid WebUI access key is required'
  }
})

const dataApiPrefix = '/api/data'
const MAX_WEBUI_MESSAGE_CHARS = 40_000
const sessionMessagePath = /^\/api\/agent-sessions\/([^/]+)\/messages$/
const sessionAbortPath = /^\/api\/agent-sessions\/([^/]+)\/abort$/
const readableDataApiPatterns = [
  /^\/agents$/,
  /^\/agent-sessions$/,
  /^\/agent-sessions\/latest$/,
  /^\/agent-sessions\/[^/]+$/,
  /^\/agent-sessions\/[^/]+\/messages$/
] as const

const toQueryRecord = (searchParams: URLSearchParams) => {
  const query: Record<string, string> = {}

  for (const [key, value] of searchParams.entries()) {
    query[key] = value
  }

  return query
}

const isAllowedDataApiReadPath = (path: string) => readableDataApiPatterns.some((pattern) => pattern.test(path))

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_WEBUI_MESSAGE_CHARS * 4) {
      throw new Error('WebUI request body exceeds the allowed size')
    }
    chunks.push(buffer)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  return body ? (JSON.parse(body) as unknown) : undefined
}

const parseSendMessageBody = (value: unknown): WebUiSendMessageBody | undefined => {
  if (!value || typeof value !== 'object' || typeof (value as { text?: unknown }).text !== 'string') return undefined

  const text = (value as { text: string }).text.trim()
  if (!text || text.length > MAX_WEBUI_MESSAGE_CHARS) return undefined
  return { text }
}

class WebUiStreamListener implements StreamListener {
  readonly id: string

  constructor(
    private readonly sessionId: string,
    private readonly sseRelay: WebUiSseRelay
  ) {
    this.id = `webui:${sessionId}:${randomUUID()}`
  }

  onChunk(chunk: UIMessageChunk, _sourceModelId?: UniqueModelId, anchorMessageId?: string): void {
    // WebUI远程扩展，仅Win11启用，最小侵入
    // Forward the upstream-normalized UI message chunk unchanged so the WebUI
    // can render tool activity without maintaining a second stream protocol.
    this.sseRelay.broadcast({
      event: 'chunk',
      data: {
        conversationId: this.sessionId,
        messageId: anchorMessageId ?? chunk.id,
        chunk
      }
    })
  }

  onDone(result: StreamDoneResult): void {
    if (result.isTopicDone === false) return
    this.publishTerminal('success', result.anchorMessageId)
  }

  onPaused(result: StreamPausedResult): void {
    if (result.isTopicDone === false) return
    this.publishTerminal('paused', result.anchorMessageId)
  }

  onError(result: StreamErrorResult): void {
    this.sseRelay.broadcast({
      event: 'error',
      data: {
        conversationId: this.sessionId,
        messageId: result.anchorMessageId,
        message: result.error.message
      }
    })
    if (result.isTopicDone !== false) this.publishTerminal('error', result.anchorMessageId)
  }

  isAlive(): boolean {
    return true
  }

  private publishTerminal(status: 'success' | 'paused' | 'error', messageId?: string): void {
    this.sseRelay.broadcast({
      event: 'done',
      data: { conversationId: this.sessionId, messageId, status }
    })
    this.sseRelay.broadcast({
      event: 'sync',
      data: { conversationId: this.sessionId, reason: 'stream-terminal' }
    })
  }
}

const handleDataApiProxy = async (
  request: IncomingMessage,
  url: URL,
  sseRelay: WebUiSseRelay
): Promise<WebUiApiRouteResult> => {
  const dataPath = url.pathname.slice(dataApiPrefix.length) || '/'
  const method = request.method ?? 'GET'
  const isRead = method === 'GET' && isAllowedDataApiReadPath(dataPath)
  const isSessionCreate = method === 'POST' && dataPath === '/agent-sessions'

  if (!isRead && !isSessionCreate) {
    return {
      status: 404,
      body: {
        code: 'WEBUI_DATA_API_NOT_FOUND',
        message: `WebUI data route is not allowed: ${method} ${dataPath}`
      }
    }
  }

  try {
    const apiRequest: DataRequest = {
      id: randomUUID(),
      method: method as HttpMethod,
      path: dataPath,
      params: toQueryRecord(url.searchParams),
      body: isSessionCreate ? await readJsonBody(request) : undefined,
      metadata: {
        timestamp: Date.now()
      }
    }
    const apiResponse = await ApiServer.getInstance().handleRequest(apiRequest)

    const result = {
      status: apiResponse.status,
      body: apiResponse.error ?? apiResponse.data ?? null
    }
    if (isSessionCreate && apiResponse.status >= 200 && apiResponse.status < 300) {
      sseRelay.broadcast({ event: 'sync', data: { reason: 'session-created' } })
    }
    return result
  } catch (error) {
    return {
      status: 503,
      body: {
        code: 'WEBUI_DATA_API_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Data API is unavailable'
      }
    }
  }
}

export const createWebUiApiRouter = ({
  getAuthKey,
  getLanguage,
  getSseClientCount,
  sseRelay
}: WebUiApiRouterOptions): WebUiApiRouter => {
  const startedAt = new Date().toISOString()

  const route = async (request: IncomingMessage): Promise<WebUiApiRouteResult> => {
    const { method = 'GET' } = request
    const url = new URL(request.url ?? '/', 'http://webui.local')
    const { pathname } = url
    const sendMatch = pathname.match(sessionMessagePath)
    const abortMatch = pathname.match(sessionAbortPath)

    if (pathname === '/api/auth/status') {
      if (method !== 'GET') return methodNotAllowed(['GET'])

      return {
        status: 200,
        body: {
          authRequired: Boolean(normalizeAuthKey(getAuthKey())),
          language: getLanguage(),
          timestamp: new Date().toISOString()
        }
      }
    }

    if (!isWebUiRequestAuthorized(request, url, getAuthKey())) return unauthorized()

    if (sendMatch) {
      if (method !== 'POST') return methodNotAllowed(['POST'])

      try {
        const body = parseSendMessageBody(await readJsonBody(request))
        if (!body) {
          return {
            status: 400,
            body: {
              code: 'WEBUI_INVALID_MESSAGE',
              message: `Message text must contain 1-${MAX_WEBUI_MESSAGE_CHARS} characters`
            }
          }
        }

        const encodedSessionId = sendMatch[1]
        if (!encodedSessionId) throw new Error('Desktop conversation id is missing')
        const sessionId = decodeURIComponent(encodedSessionId)
        await startAgentSessionRun({
          sessionId,
          userParts: [{ type: 'text', text: body.text }] as CherryMessagePart[],
          listeners: [new WebUiStreamListener(sessionId, sseRelay)],
          headless: false
        })
        sseRelay.broadcast({ event: 'sync', data: { conversationId: sessionId, reason: 'message-submitted' } })

        return {
          status: 202,
          body: { accepted: true, conversationId: sessionId }
        }
      } catch (error) {
        return {
          status: 422,
          body: {
            code: 'WEBUI_MESSAGE_REJECTED',
            message: error instanceof Error ? error.message : 'Desktop Agent session rejected the message'
          }
        }
      }
    }

    if (abortMatch) {
      if (method !== 'POST') return methodNotAllowed(['POST'])

      try {
        const encodedSessionId = abortMatch[1]
        if (!encodedSessionId) throw new Error('Desktop conversation id is missing')
        const sessionId = decodeURIComponent(encodedSessionId)
        const aborted = application.get('AgentSessionRuntimeService').abortPendingTurn(sessionId, 'webui-user-abort')
        if (!aborted) {
          return {
            status: 409,
            body: { code: 'WEBUI_NO_ACTIVE_RUN', message: 'This desktop conversation has no active generation' }
          }
        }

        return { status: 202, body: { accepted: true, conversationId: sessionId } }
      } catch (error) {
        return {
          status: 400,
          body: {
            code: 'WEBUI_INVALID_SESSION',
            message: error instanceof Error ? error.message : 'Invalid desktop conversation id'
          }
        }
      }
    }

    if (pathname.startsWith(`${dataApiPrefix}/`)) {
      return handleDataApiProxy(request, url, sseRelay)
    }

    if (pathname === '/api/health') {
      if (method !== 'GET') return methodNotAllowed(['GET'])

      return {
        status: 200,
        body: {
          ok: true,
          language: getLanguage(),
          service: 'cherry-studio-webui',
          startedAt,
          sseClients: getSseClientCount(),
          timestamp: new Date().toISOString()
        }
      }
    }

    if (pathname === '/api/sse/status') {
      if (method !== 'GET') return methodNotAllowed(['GET'])

      return {
        status: 200,
        body: {
          clients: getSseClientCount()
        }
      }
    }

    return {
      status: 404,
      body: {
        code: 'WEBUI_API_NOT_FOUND',
        message: `Unknown WebUI API route: ${pathname}`
      }
    }
  }

  return {
    async handle(request, response) {
      writeJson(response, await route(request))
    }
  }
}
