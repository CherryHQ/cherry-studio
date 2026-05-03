import { useSharedCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { useToolApprovalRespond } from '@renderer/hooks/ToolApprovalContext'
import { usePartsMap } from '@renderer/pages/home/Messages/Blocks'
import type { MCPToolResponse, NormalToolResponse } from '@renderer/types'
import type { PermissionRule } from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'

import { APPROVAL_REQUESTED, APPROVAL_RESPONDED, findToolPartByCallId } from '../toolResponse'

const logger = loggerService.withContext('useToolApproval')

/**
 * Unified tool approval state. AI-SDK-v6 `ToolUIPart.state` drives every
 * field — MCP and Claude-Agent tools no longer diverge at the hook layer;
 * the bridge decides transport-specific dispatch internally.
 */
export interface ToolApprovalState {
  isWaiting: boolean
  isExecuting: boolean
  isSubmitting: boolean
  input?: Record<string, unknown>
}

export interface ToolApprovalActions {
  confirm: () => void | Promise<void>
  cancel: () => void | Promise<void>
  autoApprove?: () => void | Promise<void>
}

type ToolApprovalTarget = MCPToolResponse | NormalToolResponse

const IDLE: ToolApprovalState & ToolApprovalActions = {
  isWaiting: false,
  isExecuting: false,
  isSubmitting: false,
  confirm: () => {},
  cancel: () => {}
}

/**
 * Read approval state off the active `ToolUIPart` for a given tool call
 * and expose confirm/cancel/autoApprove that route through the shared bridge.
 *
 * `autoApprove` is wired from a per-call shared-cache entry
 * (`tool_approval.suggested_rule.${toolCallId}`) populated by main when
 * a tool's L3 hook returns 'ask' with a `suggestedRule`. When present,
 * clicking "Allow always: <pattern>" dispatches the approval AND persists
 * the rule, so the next matching invocation auto-allows at L4.
 */
export function useToolApproval(target: ToolApprovalTarget): ToolApprovalState & ToolApprovalActions {
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const respondToolApproval = useToolApprovalRespond()

  const toolCallId = target.toolCallId ?? target.id ?? ''
  const match = useMemo(() => findToolPartByCallId(partsMap, toolCallId), [partsMap, toolCallId])

  const [suggestedRule] = useSharedCache(`tool_approval.suggested_rule.${toolCallId}`)

  const respond = useCallback(
    async (approved: boolean, persistRule?: PermissionRule) => {
      if (!match?.approvalId || !respondToolApproval) return
      try {
        await respondToolApproval({
          match,
          approved,
          reason: approved ? undefined : t('message.tools.denied', 'User denied tool execution'),
          persistRule
        })
      } catch (error) {
        logger.error('Tool approval response failed', error as Error)
        window.toast?.error?.(t('message.tools.approvalError', 'Failed to send approval'))
      }
    },
    [match, respondToolApproval, t]
  )

  const autoApprove = useMemo(() => {
    if (!suggestedRule) return undefined
    return () => {
      const rule: PermissionRule = {
        id: uuidv4(),
        toolName: suggestedRule.toolName,
        ruleContent: suggestedRule.ruleContent,
        behavior: 'allow',
        source: 'userPreference',
        createdAt: Date.now()
      }
      void respond(true, rule)
    }
  }, [suggestedRule, respond])

  if (!match?.approvalId) return IDLE

  return {
    isWaiting: match.state === APPROVAL_REQUESTED,
    // `input-available` = SDK has inputs, tool about to run (post-approval).
    isExecuting: match.state === APPROVAL_RESPONDED || match.state === 'input-available',
    isSubmitting: false,
    input: match.input as Record<string, unknown> | undefined,
    confirm: () => void respond(true),
    cancel: () => void respond(false),
    autoApprove
  }
}
