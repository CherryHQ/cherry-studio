import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Badge, Button } from '@cherrystudio/ui'
import AskUserQuestionComposer from '@renderer/components/composer/variants/AskUserQuestionComposer'
import { findLatestPendingAskUserQuestionRequest } from '@renderer/components/composer/variants/askUserQuestionComposerRequest'
import PermissionRequestComposer from '@renderer/components/composer/variants/PermissionRequestComposer'
import { findNextPendingPermissionRequest } from '@renderer/components/composer/variants/permissionRequestComposerRequest'
import { ipcApi } from '@renderer/ipc'
import type { CherryMessagePart } from '@shared/data/types/message'
import { CONVERSATION_ROUTES } from '@shared/utils/conversationRoute'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { MessageToolApprovalInput } from '../../types'
import { parseSessionCreateResult } from './sessionToolResult'

export function AgentDelegationCard({ output }: { output: unknown }) {
  const receipt = parseSessionCreateResult(output)
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const originSessionId = receipt?.originSessionId
  const requestId = receipt?.requestId
  const { data, error, mutate } = useSWR(
    originSessionId && requestId ? ['agent-delegation', originSessionId, requestId] : null,
    () => ipcApi.request('ai.agent.delegation.read', { originSessionId: originSessionId!, requestId: requestId! }),
    { refreshInterval: (snapshot) => (snapshot?.terminal ? 0 : 1000) }
  )
  if (!originSessionId || !requestId) return null

  const parts: CherryMessagePart[] = (data?.approvals ?? []).map((approval) => ({
    type: `tool-${approval.toolName}`,
    toolCallId: approval.toolCallId,
    state: 'approval-requested',
    input: approval.input,
    approval: { id: approval.approvalId }
  }))
  const partsByMessageId = { [data?.delivery.turnRef ?? requestId]: parts }
  const question = findLatestPendingAskUserQuestionRequest(partsByMessageId)
  const permission = question ? null : findNextPendingPermissionRequest(partsByMessageId)
  const label = data?.approvals.length
    ? t('chat.message.flow.status.awaiting_input')
    : data?.delivery.error?.code === 'CANCELLED'
      ? t('message.tools.cancelled')
      : data?.delivery.outcome === 'failed' || data?.delivery.status === 'failed'
        ? t('message.tools.error')
        : data?.delivery.outcome === 'interrupted'
          ? t('message.tools.cancelled')
          : data?.terminal
            ? t('agent.tasks.logs.completed')
            : data?.delivery.status === 'delivering'
              ? t('message.tools.status.running')
              : t('message.tools.pending')

  const respond = async ({ match, approved, reason, updatedInput }: MessageToolApprovalInput) => {
    const ok = await ipcApi.request('ai.agent.delegation.respond', {
      originSessionId,
      requestId,
      approvalId: match.approvalId,
      approved,
      reason,
      updatedInput
    })
    if (!ok) throw new Error(t('agent.toolPermission.error.sendFailed'))
    await mutate()
  }
  const cancel = async () => {
    setSubmitting(true)
    setActionError(undefined)
    try {
      await ipcApi.request('ai.agent.delegation.cancel', { originSessionId, requestId })
      await mutate()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }
  const route = CONVERSATION_ROUTES.agent
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3" data-testid="agent-delegation-card">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{data?.agentName ?? t('message.tools.sessionCreate.untitled')}</span>
        <Badge variant="outline">{label}</Badge>
      </div>
      {data?.workspacePath && <div className="break-all text-muted-foreground text-xs">{data.workspacePath}</div>}
      {(error || actionError) && (
        <div role="alert" className="text-error text-xs">
          {actionError ?? String(error)}
        </div>
      )}
      {data?.delivery.error && <div className="text-error text-xs">{data.delivery.error.message}</div>}
      {question && <AskUserQuestionComposer key={question.approvalId} request={question} onRespond={respond} />}
      {permission && (
        <PermissionRequestComposer
          keyboardShortcuts={false}
          key={permission.approvalId}
          request={permission}
          onRespond={respond}
        />
      )}
      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void actions?.navigateToRoute?.({ path: route.path, query: { [route.keyParam]: receipt.sessionId } })
          }>
          {t('message.tools.sessionCreate.open')}
        </Button>
        {!data?.terminal && (
          <Button variant="outline" size="sm" disabled={submitting || !data} onClick={() => void cancel()}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </div>
  )
}
