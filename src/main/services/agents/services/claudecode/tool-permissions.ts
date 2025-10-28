import { randomUUID } from 'node:crypto'

import { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { windowService } from '../../../WindowService'
import { builtinTools } from './tools'

const logger = loggerService.withContext('ClaudeCodeService')

const TOOL_APPROVAL_TIMEOUT_MS = 30_000
const MAX_PREVIEW_LENGTH = 2_000
const shouldAutoApproveTools = process.env.CHERRY_AUTO_ALLOW_TOOLS === '1'

type ToolPermissionBehavior = 'allow' | 'deny'

type ToolPermissionResponsePayload = {
  requestId: string
  behavior: ToolPermissionBehavior
  updatedInput?: unknown
  message?: string
  updatedPermissions?: PermissionUpdate[]
}

type PendingPermissionRequest = {
  fulfill: (update: PermissionResult) => void
  timeout: NodeJS.Timeout
  signal?: AbortSignal
  abortListener?: () => void
  originalInput: Record<string, unknown>
  toolName: string
}

type RendererPermissionRequestPayload = {
  requestId: string
  toolName: string
  toolId: string
  description?: string
  requiresPermissions: boolean
  input: Record<string, unknown>
  inputPreview: string
  createdAt: number
  expiresAt: number
  suggestions: PermissionUpdate[]
}

type RendererPermissionResultPayload = {
  requestId: string
  behavior: ToolPermissionBehavior
  message?: string
  reason: 'response' | 'timeout' | 'aborted' | 'no-window'
}

const pendingRequests = new Map<string, PendingPermissionRequest>()
let ipcHandlersInitialized = false

const jsonReplacer = (_key: string, value: unknown) => {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Map) return Object.fromEntries(value.entries())
  if (value instanceof Set) return Array.from(value.values())
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'function') return undefined
  if (value === undefined) return undefined
  return value
}

const sanitizeStructuredData = <T>(value: T): T => {
  try {
    return JSON.parse(JSON.stringify(value, jsonReplacer)) as T
  } catch (error) {
    logger.warn('Failed to sanitize structured data for tool permission payload', {
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error)
    })
    return value
  }
}

const buildInputPreview = (value: unknown): string => {
  let preview: string

  try {
    preview = JSON.stringify(value, null, 2)
  } catch (error) {
    preview = typeof value === 'string' ? value : String(value)
  }

  if (preview.length > MAX_PREVIEW_LENGTH) {
    preview = `${preview.slice(0, MAX_PREVIEW_LENGTH)}...`
  }

  return preview
}

const broadcastToRenderer = (
  channel: IpcChannel,
  payload: RendererPermissionRequestPayload | RendererPermissionResultPayload
): boolean => {
  const mainWindow = windowService.getMainWindow()

  if (!mainWindow) {
    logger.warn('Unable to send agent tool permission payload – main window unavailable', {
      channel,
      requestId: 'requestId' in payload ? payload.requestId : undefined
    })
    return false
  }

  mainWindow.webContents.send(channel, payload)

  return true
}

const finalizeRequest = (
  requestId: string,
  update: PermissionResult,
  reason: RendererPermissionResultPayload['reason']
) => {
  const pending = pendingRequests.get(requestId)

  if (!pending) {
    logger.debug('Attempted to finalize unknown tool permission request', { requestId, reason })
    return false
  }

  logger.debug('Finalizing tool permission request', {
    requestId,
    toolName: pending.toolName,
    behavior: update.behavior,
    reason
  })

  pendingRequests.delete(requestId)
  clearTimeout(pending.timeout)

  if (pending.signal && pending.abortListener) {
    pending.signal.removeEventListener('abort', pending.abortListener)
  }

  pending.fulfill(update)

  const resultPayload: RendererPermissionResultPayload = {
    requestId,
    behavior: update.behavior,
    message: update.behavior === 'deny' ? update.message : undefined,
    reason
  }

  const dispatched = broadcastToRenderer(IpcChannel.AgentToolPermission_Result, resultPayload)

  logger.debug('Sent tool permission result to renderer', {
    requestId,
    dispatched
  })

  return true
}

const ensureIpcHandlersRegistered = () => {
  if (ipcHandlersInitialized) return

  ipcHandlersInitialized = true

  ipcMain.handle(IpcChannel.AgentToolPermission_Response, async (_event, payload: ToolPermissionResponsePayload) => {
    logger.debug('main received AgentToolPermission_Response', payload)
    const { requestId, behavior, updatedInput, message } = payload
    const pending = pendingRequests.get(requestId)

    if (!pending) {
      logger.warn('Received renderer tool permission response for unknown request', { requestId })
      return { success: false, error: 'unknown-request' }
    }

    logger.debug('Received renderer response for tool permission', {
      requestId,
      toolName: pending.toolName,
      behavior,
      hasUpdatedPermissions: Array.isArray(payload.updatedPermissions) && payload.updatedPermissions.length > 0
    })

    const maybeUpdatedInput =
      updatedInput && typeof updatedInput === 'object' && !Array.isArray(updatedInput)
        ? (updatedInput as Record<string, unknown>)
        : pending.originalInput

    const sanitizedUpdatedPermissions = Array.isArray(payload.updatedPermissions)
      ? payload.updatedPermissions.map((perm) => sanitizeStructuredData(perm))
      : undefined

    const finalUpdate: PermissionResult =
      behavior === 'allow'
        ? {
            behavior: 'allow',
            updatedInput: sanitizeStructuredData(maybeUpdatedInput),
            updatedPermissions: sanitizedUpdatedPermissions
          }
        : {
            behavior: 'deny',
            message: message ?? 'User denied permission for this tool'
          }

    finalizeRequest(requestId, finalUpdate, 'response')

    return { success: true }
  })
}

export async function promptForToolApproval(
  toolName: string,
  input: Record<string, unknown>,
  options?: { signal: AbortSignal; suggestions?: PermissionUpdate[] }
): Promise<PermissionResult> {
  if (shouldAutoApproveTools) {
    logger.debug('promptForToolApproval auto-approving tool for test', {
      toolName
    })

    return { behavior: 'allow', updatedInput: input }
  }

  ensureIpcHandlersRegistered()

  if (options?.signal?.aborted) {
    logger.info('Skipping tool approval prompt because request signal is already aborted', { toolName })
    return { behavior: 'deny', message: 'Tool request was cancelled before prompting the user' }
  }

  const mainWindow = windowService.getMainWindow()

  if (!mainWindow) {
    logger.warn('Denying tool usage because no renderer window is available to obtain approval', { toolName })
    return { behavior: 'deny', message: 'Unable to request approval – renderer not ready' }
  }

  const toolMetadata = builtinTools.find((tool) => tool.name === toolName || tool.id === toolName)
  const sanitizedInput = sanitizeStructuredData(input)
  const inputPreview = buildInputPreview(sanitizedInput)
  const sanitizedSuggestions = (options?.suggestions ?? []).map((suggestion) => sanitizeStructuredData(suggestion))

  const requestId = randomUUID()
  const createdAt = Date.now()
  const expiresAt = createdAt + TOOL_APPROVAL_TIMEOUT_MS

  logger.info('Requesting user approval for tool usage', {
    requestId,
    toolName,
    description: toolMetadata?.description
  })

  const requestPayload: RendererPermissionRequestPayload = {
    requestId,
    toolName,
    toolId: toolMetadata?.id ?? toolName,
    description: toolMetadata?.description,
    requiresPermissions: toolMetadata?.requirePermissions ?? false,
    input: sanitizedInput,
    inputPreview,
    createdAt,
    expiresAt,
    suggestions: sanitizedSuggestions
  }

  const defaultDenyUpdate: PermissionResult = { behavior: 'deny', message: 'Tool request aborted before user decision' }

  logger.debug('Registering tool permission request', {
    requestId,
    toolName,
    requiresPermissions: requestPayload.requiresPermissions,
    timeoutMs: TOOL_APPROVAL_TIMEOUT_MS,
    suggestionCount: sanitizedSuggestions.length
  })

  return new Promise<PermissionResult>((resolve) => {
    const timeout = setTimeout(() => {
      logger.info('User tool permission request timed out', { requestId, toolName })
      finalizeRequest(requestId, { behavior: 'deny', message: 'Timed out waiting for approval' }, 'timeout')
    }, TOOL_APPROVAL_TIMEOUT_MS)

    const pending: PendingPermissionRequest = {
      fulfill: resolve,
      timeout,
      originalInput: sanitizedInput,
      toolName,
      signal: options?.signal
    }

    if (options?.signal) {
      const abortListener = () => {
        logger.info('Tool permission request aborted before user responded', { requestId, toolName })
        finalizeRequest(requestId, defaultDenyUpdate, 'aborted')
      }

      pending.abortListener = abortListener
      options.signal.addEventListener('abort', abortListener, { once: true })
    }

    pendingRequests.set(requestId, pending)

    logger.debug('Pending tool permission request count', {
      count: pendingRequests.size
    })

    const sent = broadcastToRenderer(IpcChannel.AgentToolPermission_Request, requestPayload)

    logger.debug('Broadcasted tool permission request to renderer', {
      requestId,
      toolName,
      sent
    })

    if (!sent) {
      finalizeRequest(
        requestId,
        {
          behavior: 'deny',
          message: 'Unable to request approval because the renderer window is unavailable'
        },
        'no-window'
      )
    }
  })
}
