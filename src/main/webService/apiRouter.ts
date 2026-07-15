// WebUI远程扩展，仅Win11启用，最小侵入
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { startAgentSessionRun } from '@main/ai/streamManager/api/startAgentSessionRun'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '@main/ai/streamManager/types'
import { ApiServer } from '@main/data/api'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentService } from '@data/services/AgentService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY } from '@shared/ai/agentSessionContextUsage'
import { AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY } from '@shared/ai/agentSessionSlashCommands'
import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Base64String } from '@shared/types/file'
import type { DataRequest, HttpMethod } from '@shared/data/api/types'
import { getModelSupportedReasoningEffortOptions, isNonChatModel } from '@shared/utils/model'
import { isExternalCliProvider } from '@shared/utils/provider'
import type { UIMessageChunk } from 'ai'
import { app } from 'electron'

import type { WebUiSseRelay } from './sseRelay'
import {
  listWebUiWorkspaceFiles,
  readWebUiWorkspaceBinaryPreview,
  readWebUiWorkspaceTextFile,
  WebUiWorkspaceFileError
} from './workspaceFiles'

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
  readonly rawBody?: Buffer
  readonly headers?: Readonly<Record<string, string | number>>
}

type WebUiSendMessageBody = {
  readonly text: string
  readonly attachments: readonly WebUiSendAttachment[]
  readonly reasoningEffort?: string
}

type WebUiSendAttachment = {
  readonly name: string
  readonly mediaType: string
  readonly size: number
  readonly dataUrl: Base64String
}

type WebUiUpdateSessionModelBody = {
  readonly model: UniqueModelId
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

const writeResult = (response: ServerResponse, result: WebUiApiRouteResult) => {
  if (result.rawBody !== undefined) {
    response.writeHead(result.status, {
      'Cache-Control': 'no-store',
      'Content-Length': result.rawBody.byteLength,
      'X-Content-Type-Options': 'nosniff',
      ...result.headers
    })
    response.end(result.rawBody)
    return
  }
  response.writeHead(result.status, jsonHeaders)
  response.end(JSON.stringify(result.body ?? null))
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
const MAX_WEBUI_ATTACHMENT_COUNT = 5
const MAX_WEBUI_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_WEBUI_ATTACHMENTS_BYTES = 25 * 1024 * 1024
const MAX_WEBUI_REQUEST_BYTES = 40 * 1024 * 1024
const webUiModelsPath = '/api/webui/models'
const sessionMessagePath = /^\/api\/agent-sessions\/([^/]+)\/messages$/
const sessionAbortPath = /^\/api\/agent-sessions\/([^/]+)\/abort$/
const sessionContextUsagePath = /^\/api\/agent-sessions\/([^/]+)\/context-usage$/
const sessionSlashCommandsPath = /^\/api\/agent-sessions\/([^/]+)\/slash-commands$/
const sessionModelPath = /^\/api\/agent-sessions\/([^/]+)\/model$/
const sessionWorkspaceFilesPath = /^\/api\/agent-sessions\/([^/]+)\/workspace\/files$/
const sessionWorkspaceFilePath = /^\/api\/agent-sessions\/([^/]+)\/workspace\/file$/
const sessionWorkspacePreviewPath = /^\/api\/agent-sessions\/([^/]+)\/workspace\/preview$/
const readableDataApiPatterns = [
  /^\/agents$/,
  /^\/models$/,
  /^\/agent-sessions$/,
  /^\/agent-sessions\/latest$/,
  /^\/agent-sessions\/[^/]+$/,
  /^\/agent-sessions\/[^/]+\/messages$/
] as const
const deletableDataApiMessagePath = /^\/agent-sessions\/([^/]+)\/messages\/[^/]+$/

const toQueryRecord = (searchParams: URLSearchParams) => {
  const query: Record<string, string> = {}

  for (const [key, value] of searchParams.entries()) {
    query[key] = value
  }

  return query
}

const isAllowedDataApiReadPath = (path: string) => readableDataApiPatterns.some((pattern) => pattern.test(path))

const readJsonBody = async (request: IncomingMessage, maxBytes = MAX_WEBUI_MESSAGE_CHARS * 4): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      throw new Error('WebUI request body exceeds the allowed size')
    }
    chunks.push(buffer)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  return body ? (JSON.parse(body) as unknown) : undefined
}

const parseSendMessageBody = (value: unknown): WebUiSendMessageBody | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { text?: unknown; attachments?: unknown; reasoningEffort?: unknown }
  if (typeof candidate.text !== 'string') return undefined

  const text = candidate.text.trim()
  if (text.length > MAX_WEBUI_MESSAGE_CHARS) return undefined
  const rawAttachments = candidate.attachments ?? []
  if (!Array.isArray(rawAttachments) || rawAttachments.length > MAX_WEBUI_ATTACHMENT_COUNT) return undefined

  let totalBytes = 0
  const attachments: WebUiSendAttachment[] = []
  for (const raw of rawAttachments) {
    if (!raw || typeof raw !== 'object') return undefined
    const item = raw as { name?: unknown; mediaType?: unknown; size?: unknown; dataUrl?: unknown }
    if (
      typeof item.name !== 'string' ||
      typeof item.mediaType !== 'string' ||
      typeof item.size !== 'number' ||
      typeof item.dataUrl !== 'string'
    ) {
      return undefined
    }
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(item.dataUrl)
    if (!match || match[1] !== item.mediaType) return undefined
    const estimatedBytes = Math.floor((match[2]?.length ?? 0) * 0.75)
    if (estimatedBytes <= 0 || estimatedBytes > MAX_WEBUI_ATTACHMENT_BYTES) return undefined
    totalBytes += estimatedBytes
    if (totalBytes > MAX_WEBUI_ATTACHMENTS_BYTES) return undefined
    attachments.push({
      name: path.basename(item.name).slice(0, 255) || 'attachment',
      mediaType: item.mediaType,
      size: estimatedBytes,
      dataUrl: item.dataUrl as Base64String
    })
  }
  if (!text && attachments.length === 0) return undefined
  const reasoningEffort = typeof candidate.reasoningEffort === 'string' ? candidate.reasoningEffort : undefined
  return { text, attachments, ...(reasoningEffort ? { reasoningEffort } : {}) }
}

const parseUpdateSessionModelBody = (value: unknown): WebUiUpdateSessionModelBody | undefined => {
  if (!value || typeof value !== 'object' || typeof (value as { model?: unknown }).model !== 'string') return undefined

  const model = (value as { model: string }).model
  return isUniqueModelId(model) ? { model } : undefined
}

const listWebUiChatModelGroups = () => {
  // WebUI 远程扩展，仅 Win11 启用，最小侵入。
  const providers = providerService.list({ enabled: true }).filter((provider) => !isExternalCliProvider(provider))
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const models = modelService
    .list({ enabled: true })
    .filter((model) => providerById.has(model.providerId) && !model.isHidden && !isNonChatModel(model))

  return providers.flatMap((provider) => {
    const providerModels = models
      .filter((model) => model.providerId === provider.id)
      .sort((left, right) => {
        const leftGroup = left.group ?? ''
        const rightGroup = right.group ?? ''
        return leftGroup.localeCompare(rightGroup) || left.name.localeCompare(right.name)
      })

    if (providerModels.length === 0) return []

    return [
      {
        id: provider.id,
        name: provider.name || provider.id,
        models: providerModels.map((model) => ({
          ...model,
          reasoningOptions: getModelSupportedReasoningEffortOptions(model)
        }))
      }
    ]
  })
}

const findWebUiChatModel = (modelId: UniqueModelId) => {
  for (const group of listWebUiChatModelGroups()) {
    const model = group.models.find((candidate) => candidate.id === modelId)
    if (model) return model
  }

  return undefined
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
    const chunkMessageId = 'id' in chunk && typeof chunk.id === 'string' ? chunk.id : undefined
    const messageId = anchorMessageId ?? chunkMessageId
    if (!messageId) return

    this.sseRelay.broadcast({
      event: 'chunk',
      data: {
        conversationId: this.sessionId,
        messageId,
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
  const sessionMessageDeleteMatch = method === 'DELETE' ? dataPath.match(deletableDataApiMessagePath) : null

  if (!isRead && !isSessionCreate && !sessionMessageDeleteMatch) {
    return {
      status: 404,
      body: {
        code: 'WEBUI_DATA_API_NOT_FOUND',
        message: `WebUI data route is not allowed: ${method} ${dataPath}`
      }
    }
  }

  try {
    const body = isSessionCreate ? await readJsonBody(request) : undefined
    const apiRequest: DataRequest = {
      id: randomUUID(),
      method: method as HttpMethod,
      path: dataPath,
      params: toQueryRecord(url.searchParams),
      body,
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
    if (sessionMessageDeleteMatch && apiResponse.status >= 200 && apiResponse.status < 300) {
      sseRelay.broadcast({
        event: 'sync',
        data: { conversationId: decodeURIComponent(sessionMessageDeleteMatch[1] ?? ''), reason: 'message-deleted' }
      })
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
    const contextUsageMatch = pathname.match(sessionContextUsagePath)
    const slashCommandsMatch = pathname.match(sessionSlashCommandsPath)
    const sessionModelMatch = pathname.match(sessionModelPath)
    const workspaceFilesMatch = pathname.match(sessionWorkspaceFilesPath)
    const workspaceFileMatch = pathname.match(sessionWorkspaceFilePath)
    const workspacePreviewMatch = pathname.match(sessionWorkspacePreviewPath)

    if (pathname === '/api/auth/status') {
      if (method !== 'GET') return methodNotAllowed(['GET'])

      return {
        status: 200,
        body: {
          authRequired: Boolean(normalizeAuthKey(getAuthKey())),
          language: getLanguage(),
          // WebUI 远程扩展，仅 Win11 启用，最小侵入。
          userName: application.get('PreferenceService').get('app.user.name'),
          timestamp: new Date().toISOString()
        }
      }
    }

    if (!isWebUiRequestAuthorized(request, url, getAuthKey())) return unauthorized()

    const workspaceMatch = workspaceFilesMatch ?? workspaceFileMatch ?? workspacePreviewMatch
    if (workspaceMatch) {
      if (method !== 'GET') return methodNotAllowed(['GET'])
      if (!normalizeAuthKey(getAuthKey())) {
        return {
          status: 403,
          body: {
            code: 'WEBUI_WORKSPACE_AUTH_REQUIRED',
            message: 'Configure a WebUI access key before enabling workspace file access'
          }
        }
      }

      try {
        const encodedSessionId = workspaceMatch[1]
        if (!encodedSessionId) {
          return { status: 400, body: { code: 'WEBUI_INVALID_SESSION', message: 'Desktop conversation id is missing' } }
        }
        const session = agentSessionService.getById(decodeURIComponent(encodedSessionId))
        const requestedPath = url.searchParams.get('path') ?? ''

        if (workspaceFilesMatch) {
          const result = await listWebUiWorkspaceFiles(
            session.workspace.path,
            requestedPath,
            url.searchParams.get('search') ?? ''
          )
          return { status: 200, body: result }
        }
        if (workspaceFileMatch) {
          return { status: 200, body: await readWebUiWorkspaceTextFile(session.workspace.path, requestedPath) }
        }

        const preview = await readWebUiWorkspaceBinaryPreview(session.workspace.path, requestedPath)
        return {
          status: 200,
          rawBody: preview.bytes,
          headers: {
            'Content-Type': preview.contentType,
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(preview.name)}`,
            'X-Content-Type-Options': 'nosniff'
          }
        }
      } catch (error) {
        if (error instanceof WebUiWorkspaceFileError) {
          return { status: error.status, body: { code: error.code, message: error.message } }
        }
        return {
          status: 404,
          body: {
            code: 'WEBUI_WORKSPACE_UNAVAILABLE',
            message: 'Workspace is unavailable'
          }
        }
      }
    }

    if (pathname === webUiModelsPath) {
      if (method !== 'GET') return methodNotAllowed(['GET'])

      return { status: 200, body: { groups: listWebUiChatModelGroups() } }
    }

    if (contextUsageMatch) {
      if (method !== 'GET') return methodNotAllowed(['GET'])
      const encodedSessionId = contextUsageMatch[1]
      if (!encodedSessionId) return { status: 400, body: { code: 'WEBUI_INVALID_SESSION', message: 'Desktop conversation id is missing' } }
      const sessionId = decodeURIComponent(encodedSessionId)
      const cacheService = application.get('CacheService')
      let usage = cacheService.getShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId))

      if (!usage) {
        // WebUI 远程扩展，仅 Win11 启用，最小侵入。
        await application.get('AgentSessionRuntimeService').primeConnection(sessionId)
        for (let attempt = 0; attempt < 8 && !usage; attempt += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50))
          usage = cacheService.getShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId))
        }
      }

      return { status: 200, body: { usage } }
    }

    if (slashCommandsMatch) {
      if (method !== 'GET') return methodNotAllowed(['GET'])
      const encodedSessionId = slashCommandsMatch[1]
      if (!encodedSessionId) return { status: 400, body: { code: 'WEBUI_INVALID_SESSION', message: 'Desktop conversation id is missing' } }
      const sessionId = decodeURIComponent(encodedSessionId)
      // WebUI 远程扩展，仅 Win11 启用，最小侵入。
      const commands = application.get('CacheService').getShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(sessionId)) ?? []
      return { status: 200, body: { commands } }
    }

    if (sessionModelMatch) {
      if (method !== 'PATCH') return methodNotAllowed(['PATCH'])

      try {
        const body = parseUpdateSessionModelBody(await readJsonBody(request))
        if (!body) return { status: 400, body: { code: 'WEBUI_INVALID_MODEL', message: 'A valid model id is required' } }

        const encodedSessionId = sessionModelMatch[1]
        if (!encodedSessionId) return { status: 400, body: { code: 'WEBUI_INVALID_SESSION', message: 'Desktop conversation id is missing' } }
        const session = agentSessionService.getById(decodeURIComponent(encodedSessionId))
        if (!session.agentId) return { status: 409, body: { code: 'WEBUI_AGENT_UNAVAILABLE', message: 'This conversation has no Agent' } }

        const model = findWebUiChatModel(body.model)
        if (!model) {
          return { status: 422, body: { code: 'WEBUI_MODEL_UNAVAILABLE', message: 'The selected desktop model is unavailable for this Agent' } }
        }

        // WebUI 远程扩展，仅 Win11 启用，最小侵入。
        const agent = agentService.updateAgent(session.agentId, { model: body.model })
        if (!agent) return { status: 404, body: { code: 'WEBUI_AGENT_NOT_FOUND', message: 'Desktop Agent was not found' } }
        sseRelay.broadcast({ event: 'sync', data: { conversationId: session.id, reason: 'agent-model-updated' } })
        return { status: 200, body: { agent } }
      } catch (error) {
        return {
          status: 422,
          body: { code: 'WEBUI_MODEL_UPDATE_REJECTED', message: error instanceof Error ? error.message : 'Desktop Agent model update rejected' }
        }
      }
    }

    if (sendMatch) {
      if (method !== 'POST') return methodNotAllowed(['POST'])

      try {
        const body = parseSendMessageBody(await readJsonBody(request, MAX_WEBUI_REQUEST_BYTES))
        if (!body) {
          return {
            status: 400,
            body: {
              code: 'WEBUI_INVALID_MESSAGE',
              message: `A message requires text (up to ${MAX_WEBUI_MESSAGE_CHARS} characters) or a valid attachment`
            }
          }
        }

        const encodedSessionId = sendMatch[1]
        if (!encodedSessionId) throw new Error('Desktop conversation id is missing')
        const sessionId = decodeURIComponent(encodedSessionId)
        // WebUI 远程扩展，仅 Win11 启用，最小侵入。
        // Browser files are promoted into Cherry's native file store before the
        // canonical agent-session send path receives them.
        const fileManager = application.get('FileManager')
        const createdEntryIds: Parameters<typeof fileManager.batchPermanentDelete>[0] = []
        try {
          const fileParts: CherryMessagePart[] = []
          for (const attachment of body.attachments) {
            const entry = await fileManager.createInternalEntry({
              source: 'bytes',
              data: Buffer.from(attachment.dataUrl.slice(attachment.dataUrl.indexOf(',') + 1), 'base64'),
              name: path.parse(attachment.name).name || 'attachment',
              ext: path.extname(attachment.name).slice(1) || null
            })
            createdEntryIds.push(entry.id)
            const physicalPath = fileManager.getPhysicalPath(entry.id)
            fileParts.push(
              withCherryMeta(
                {
                  type: 'file',
                  mediaType: attachment.mediaType,
                  url: pathToFileURL(physicalPath).toString(),
                  filename: attachment.name
                },
                { fileEntryId: entry.id, fileTokenSourceId: randomUUID() }
              ) as CherryMessagePart
            )
          }
          const userParts: CherryMessagePart[] = [
            ...(body.text ? ([{ type: 'text', text: body.text }] as CherryMessagePart[]) : []),
            ...fileParts
          ]
          await startAgentSessionRun({
            sessionId,
            userParts,
            listeners: [new WebUiStreamListener(sessionId, sseRelay)],
            headless: false
          })
        } catch (error) {
          if (createdEntryIds.length > 0) {
            void fileManager.batchPermanentDelete(createdEntryIds).catch(() => undefined)
          }
          throw error
        }
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
          appVersion: app.getVersion(),
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
      writeResult(response, await route(request))
    }
  }
}
