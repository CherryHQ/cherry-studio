import { randomUUID } from 'node:crypto'

import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { windowService } from '../../../WindowService'
import { builtinTools } from './tools'

const logger = loggerService.withContext('ClaudeCodeService')

// https://platform.claude.com/docs/en/agent-sdk/user-input#limitations
const TOOL_APPROVAL_TIMEOUT_MS = 60_000
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
  toolCallId?: string
}

type RendererPermissionRequestPayload = {
  requestId: string
  toolName: string
  toolId: string
  toolCallId: string
  description?: string
  requiresPermissions: boolean
  input: Record<string, unknown>
  inputPreview: string
  createdAt: number
  expiresAt: number
  suggestions: PermissionUpdate[]
  autoApprove?: boolean
}

type RendererPermissionResultPayload = {
  requestId: string
  behavior: ToolPermissionBehavior
  message?: string
  reason: 'response' | 'timeout' | 'aborted' | 'no-window'
  toolCallId?: string
  updatedInput?: Record<string, unknown>
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
    reason,
    toolCallId: pending.toolCallId,
    updatedInput: update.behavior === 'allow' ? update.updatedInput : undefined
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

  // Handler for ExitPlanMode approval responses
  ipcMain.handle(
    IpcChannel.AgentExitPlanModeApproval_Response,
    async (_event, payload: ToolPermissionResponsePayload) => {
      logger.debug('main received AgentExitPlanModeApproval_Response', payload)
      const { requestId, behavior, updatedInput, message } = payload
      const pending = pendingRequests.get(requestId)

      if (!pending) {
        logger.warn('Received renderer ExitPlanMode approval response for unknown request', { requestId })
        return { success: false, error: 'unknown-request' }
      }

      logger.debug('Received renderer response for ExitPlanMode approval', {
        requestId,
        behavior,
        toolName: pending.toolName
      })

      // Finalize the request with the appropriate result based on user choice
      if (behavior === 'allow' && updatedInput && typeof updatedInput === 'object' && 'targetMode' in updatedInput) {
        const targetMode = (updatedInput as any).targetMode
        const finalUpdate: PermissionResult = {
          behavior: 'allow',
          updatedInput: { targetMode }
        }

        finalizeRequest(requestId, finalUpdate, 'response')
      } else if (behavior === 'deny') {
        const finalUpdate: PermissionResult = {
          behavior: 'deny',
          message: message ?? 'User denied ExitPlanMode approval'
        }

        finalizeRequest(requestId, finalUpdate, 'response')
      } else {
        logger.warn('Unexpected ExitPlanMode approval response format', { requestId, payload })
        finalizeRequest(requestId, { behavior: 'deny', message: 'Invalid response format' }, 'response')
      }

      return { success: true }
    }
  )
}

type PromptForToolApprovalOptions = {
  signal: AbortSignal
  suggestions?: PermissionUpdate[]
  autoApprove?: boolean

  // NOTICE: This ID is namespaced with session ID, not the raw SDK tool call ID.
  // Format: `${sessionId}:${rawToolCallId}`, e.g., `session_123:WebFetch_0`
  toolCallId: string
}

export async function promptForToolApproval(
  toolName: string,
  input: Record<string, unknown>,
  options: PromptForToolApprovalOptions
): Promise<PermissionResult> {
  try {
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
      toolCallId: options.toolCallId,
      description: toolMetadata?.description
    })

    const requestPayload: RendererPermissionRequestPayload = {
      requestId,
      toolName,
      toolId: toolMetadata?.id ?? toolName,
      toolCallId: options.toolCallId,
      description: toolMetadata?.description,
      requiresPermissions: toolMetadata?.requirePermissions ?? false,
      input: sanitizedInput,
      inputPreview,
      createdAt,
      expiresAt,
      suggestions: sanitizedSuggestions,
      autoApprove: options.autoApprove
    }

    const defaultDenyUpdate: PermissionResult = {
      behavior: 'deny',
      message: 'Tool request aborted before user decision'
    }

    logger.debug('Registering tool permission request', {
      requestId,
      toolName,
      toolCallId: options.toolCallId,
      requiresPermissions: requestPayload.requiresPermissions,
      timeoutMs: TOOL_APPROVAL_TIMEOUT_MS,
      suggestionCount: sanitizedSuggestions.length
    })

    return new Promise<PermissionResult>((resolve) => {
      const timeout = setTimeout(() => {
        logger.info('User tool permission request timed out', {
          requestId,
          toolName,
          toolCallId: options.toolCallId
        })
        finalizeRequest(requestId, { behavior: 'deny', message: 'Timed out waiting for approval' }, 'timeout')
      }, TOOL_APPROVAL_TIMEOUT_MS)

      const pending: PendingPermissionRequest = {
        fulfill: resolve,
        timeout,
        originalInput: sanitizedInput,
        toolName,
        signal: options?.signal,
        toolCallId: options.toolCallId
      }

      if (options?.signal) {
        const abortListener = () => {
          logger.info('Tool permission request aborted before user responded', {
            requestId,
            toolName,
            toolCallId: options.toolCallId
          })
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
  } catch (error) {
    logger.error('Failed to prompt for tool approval', {
      error: error instanceof Error ? error.message : String(error),
      toolName
    })
    return { behavior: 'deny', message: 'Internal error occurred while requesting tool approval' }
  }
}

/**
 * Prompts the user for ExitPlanMode approval with options for different permission modes
 */
export async function promptForExitPlanModeApproval(
  plan: string,
  currentPermissionMode: string,
  options: PromptForToolApprovalOptions
): Promise<'accept_edits' | 'default' | 'reject'> {
  try {
    ensureIpcHandlersRegistered()

    const mainWindow = windowService.getMainWindow()

    if (!mainWindow) {
      logger.warn('Unable to request ExitPlanMode approval – renderer not ready')
      return 'reject'
    }

    const requestId = randomUUID()
    const createdAt = Date.now()
    const expiresAt = createdAt + TOOL_APPROVAL_TIMEOUT_MS

    logger.info('Requesting user approval for ExitPlanMode', {
      requestId,
      currentPermissionMode,
      toolCallId: options.toolCallId
    })

    // Prepare the payload to send to the renderer for ExitPlanMode approval
    const requestPayload: RendererPermissionRequestPayload = {
      requestId,
      toolName: 'ExitPlanMode',
      toolId: 'ExitPlanMode',
      toolCallId: options.toolCallId,
      description: 'Exit plan mode approval',
      requiresPermissions: false,
      input: { plan, currentPermissionMode },
      inputPreview: `Plan: ${plan.substring(0, 100)}${plan.length > 100 ? '...' : ''}`,
      createdAt,
      expiresAt,
      suggestions: [],
      autoApprove: false
    }

    logger.debug('Registering ExitPlanMode approval request', {
      requestId,
      currentPermissionMode,
      toolCallId: options.toolCallId,
      timeoutMs: TOOL_APPROVAL_TIMEOUT_MS
    })

    return new Promise<'accept_edits' | 'default' | 'reject'>((resolve) => {
      const timeout = setTimeout(() => {
        logger.info('ExitPlanMode approval request timed out', {
          requestId,
          currentPermissionMode,
          toolCallId: options.toolCallId
        })
        resolve('reject')
        // Clean up: remove the request if it exists in pendingRequests
        const pending = pendingRequests.get(requestId)
        if (pending) {
          pendingRequests.delete(requestId)
          clearTimeout(pending.timeout)
        }
      }, TOOL_APPROVAL_TIMEOUT_MS)

      const pending: PendingPermissionRequest = {
        fulfill: (result: PermissionResult) => {
          // Map the behavior to the expected return type
          if (result.behavior === 'allow' && result.updatedInput) {
            const mode = (result.updatedInput as any).targetMode
            if (mode === 'acceptEdits') resolve('accept_edits')
            else if (mode === 'default') resolve('default')
            else resolve('reject')
          } else {
            resolve('reject')
          }
        },
        timeout,
        originalInput: { plan, currentPermissionMode },
        toolName: 'ExitPlanMode',
        signal: options?.signal,
        toolCallId: options.toolCallId
      }

      if (options?.signal) {
        const abortListener = () => {
          logger.info('ExitPlanMode approval request aborted before user responded', {
            requestId,
            currentPermissionMode,
            toolCallId: options.toolCallId
          })
          resolve('reject')
          const pending = pendingRequests.get(requestId)
          if (pending) {
            pendingRequests.delete(requestId)
            clearTimeout(pending.timeout)
          }
        }

        pending.abortListener = abortListener
        options.signal.addEventListener('abort', abortListener, { once: true })
      }

      pendingRequests.set(requestId, pending)

      logger.debug('Pending ExitPlanMode approval request count', {
        count: pendingRequests.size
      })

      // Send the special ExitPlanMode approval request to the renderer
      const sent = broadcastToRenderer(IpcChannel.AgentExitPlanModeApproval_Request, requestPayload)

      logger.debug('Broadcasted ExitPlanMode approval request to renderer', {
        requestId,
        sent
      })

      if (!sent) {
        logger.warn('Unable to broadcast ExitPlanMode approval request to renderer')
        resolve('reject')
        // Clean up: remove the request if it exists in pendingRequests
        const pending = pendingRequests.get(requestId)
        if (pending) {
          pendingRequests.delete(requestId)
          clearTimeout(pending.timeout)
        }
      }
    })
  } catch (error) {
    logger.error('Failed to prompt for ExitPlanMode approval', {
      error: error instanceof Error ? error.message : String(error),
      currentPermissionMode
    })
    return 'reject'
  }
}
