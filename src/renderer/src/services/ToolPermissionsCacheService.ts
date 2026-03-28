import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { cacheService } from '@data/CacheService'
import type { ToolPermissionEntry, ToolPermissionRequests } from '@shared/data/cache/cacheValueTypes'

export type ToolPermissionRequestPayload = {
  requestId: string
  toolName: string
  toolId: string
  toolCallId: string
  description?: string
  requiresPermissions: boolean
  input: Record<string, unknown>
  inputPreview: string
  createdAt: number
  suggestions: PermissionUpdate[]
  autoApprove?: boolean
}

export type ToolPermissionResultPayload = {
  requestId: string
  behavior: 'allow' | 'deny'
  message?: string
  reason: 'response' | 'timeout' | 'aborted' | 'no-window'
  toolCallId?: string
  updatedInput?: Record<string, unknown>
}

function getRequests(): ToolPermissionRequests {
  return cacheService.getShared('tool.permission.requests') ?? {}
}

function setRequests(requests: ToolPermissionRequests): void {
  cacheService.setShared('tool.permission.requests', requests)
}

function getResolvedInputs(): Record<string, Record<string, unknown>> {
  return cacheService.getShared('tool.permission.resolved_inputs') ?? {}
}

function setResolvedInputs(resolvedInputs: Record<string, Record<string, unknown>>): void {
  cacheService.setShared('tool.permission.resolved_inputs', resolvedInputs)
}

/**
 * Renderer-side tool permissions cache operations.
 *
 * State writes are split between Main and Renderer:
 * - Main: requestReceived (new request), requestResolved (final status)
 * - Renderer: submissionSent/Failed (user interaction status), cleanup operations
 */
export const toolPermissionsCacheService = {
  submissionSent(requestId: string, behavior: 'allow' | 'deny'): void {
    const requests = getRequests()
    const entry = requests[requestId]
    if (!entry) return

    entry.status = behavior === 'allow' ? 'submitting-allow' : 'submitting-deny'
    setRequests(requests)
  },

  submissionFailed(requestId: string): void {
    const requests = getRequests()
    const entry = requests[requestId]
    if (!entry) return

    entry.status = 'pending'
    setRequests(requests)
  },

  removeByToolCallId(toolCallId: string): void {
    const requests = getRequests()
    const entryId = Object.keys(requests).find((key) => requests[key]?.toolCallId === toolCallId)
    if (entryId) {
      delete requests[entryId]
    }
    setRequests(requests)

    const resolvedInputs = getResolvedInputs()
    delete resolvedInputs[toolCallId]
    setResolvedInputs(resolvedInputs)
  },

  clearAll(): void {
    setRequests({})
    setResolvedInputs({})
  },

  clearPending(): void {
    const requests = getRequests()
    const pendingStatuses = ['pending', 'submitting-allow', 'submitting-deny'] as const
    for (const [key, entry] of Object.entries(requests)) {
      if ((pendingStatuses as readonly string[]).includes(entry.status)) {
        delete requests[key]
      }
    }
    setRequests(requests)
  },

  getResolvedInput(toolCallId: string): Record<string, unknown> | undefined {
    return getResolvedInputs()[toolCallId]
  },

  selectActivePermission(requests: ToolPermissionRequests): ToolPermissionEntry | null {
    const activeStatuses = ['pending', 'submitting-allow', 'submitting-deny', 'invoking'] as const
    const activeEntries = Object.values(requests).filter((entry) =>
      (activeStatuses as readonly string[]).includes(entry.status)
    )

    if (activeEntries.length === 0) return null

    activeEntries.sort((a, b) => a.createdAt - b.createdAt)
    return activeEntries[0]
  },

  selectPendingPermission(requests: ToolPermissionRequests, toolCallId: string): ToolPermissionEntry | undefined {
    const activeStatuses = ['pending', 'submitting-allow', 'submitting-deny', 'invoking'] as const
    const activeEntries = Object.values(requests)
      .filter((entry) => entry.toolCallId === toolCallId)
      .filter((entry) => (activeStatuses as readonly string[]).includes(entry.status))

    if (activeEntries.length === 0) return undefined

    activeEntries.sort((a, b) => a.createdAt - b.createdAt)
    return activeEntries[0]
  }
}
