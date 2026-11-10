import { isToolUIPart } from 'ai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import AskUserQuestionComposer from '@renderer/components/composer/variants/AskUserQuestionComposer'
import { findLatestPendingAskUserQuestionRequest } from '@renderer/components/composer/variants/askUserQuestionComposerRequest'
import PermissionRequestComposer, {
  findNextPendingPermissionRequest
} from '@renderer/components/composer/variants/PermissionRequestComposer'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { AGENT_SESSION_APPROVALS_CACHE_KEY, type AgentSessionApproval } from '@shared/ai/agentSessionApprovals'
import type { CherryUIMessage } from '@shared/data/types/message'

const EMPTY: AgentSessionApproval[] = []

export function useAgentSessionApprovals(sessionId: string | undefined): AgentSessionApproval[] {
  return useSharedCacheValue(AGENT_SESSION_APPROVALS_CACHE_KEY(sessionId ?? '__none__')) ?? EMPTY
}

export function isAgentApprovalRecord(message: CherryUIMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.parts.length > 0 &&
    message.parts.every(
      (part) =>
        isToolUIPart(part) &&
        (part.callProviderMetadata?.cherry?.approvalRecord === true ||
          !!part.callProviderMetadata?.cherry?.approvalSource)
    )
  )
}

export function AgentApprovalComposer({
  sessionId,
  approvals,
  selectedMessageId,
  onSelect,
  embedded = false
}: {
  sessionId: string
  approvals: AgentSessionApproval[]
  selectedMessageId?: string
  onSelect?: (messageId: string) => void
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const [localSelection, setLocalSelection] = useState<string>()
  const pending = approvals.filter((item) => item.status === 'pending')
  const approval = pending.find((item) => item.messageId === (selectedMessageId ?? localSelection)) ?? pending[0]
  const respond = useCallback(
    async ({ approved, reason, updatedInput }: MessageToolApprovalInput) => {
      if (!approval) return
      const result = await ipcApi.request('ai.tool.respond_approval', {
        approvalId: approval.approvalId,
        anchorId: approval.messageId,
        registrationId: approval.registrationId,
        topicId: buildAgentSessionTopicId(sessionId),
        approved,
        reason,
        updatedInput
      })
      if (!result.ok) throw new Error(t('agent.approval.unavailable'))
    },
    [approval, sessionId, t]
  )
  if (!approval) return null
  const parts = { [approval.messageId]: [approval.part] }
  const question = findLatestPendingAskUserQuestionRequest(parts)
  const permission = findNextPendingPermissionRequest(parts)
  return (
    <div data-approval-registration={approval.registrationId}>
      {pending.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 px-4 py-2" aria-label={t('agent.approval.pending')}>
          <span className="text-xs text-muted-foreground">
            {t('agent.approval.pending')} · {pending.length}
          </span>
          {pending.map((item, index) => (
            <Button
              key={item.registrationId}
              variant="ghost"
              size="sm"
              aria-pressed={item.registrationId === approval.registrationId}
              onClick={() => {
                setLocalSelection(item.messageId)
                onSelect?.(item.messageId)
              }}>
              {index + 1}.{' '}
              {isToolUIPart(item.part) &&
                (item.part.type === 'dynamic-tool' ? item.part.toolName : item.part.type.slice(5))}
            </Button>
          ))}
        </div>
      )}
      {question ? (
        <AskUserQuestionComposer
          key={approval.registrationId}
          request={question}
          onRespond={respond}
          embedded={embedded}
        />
      ) : permission ? (
        <PermissionRequestComposer
          key={approval.registrationId}
          request={permission}
          onRespond={respond}
          embedded={embedded}
        />
      ) : null}
    </div>
  )
}
