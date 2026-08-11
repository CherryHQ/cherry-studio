import { Badge, Button } from '@cherrystudio/ui'
import { SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { ArrowUpRight, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { ToolInput, ToolOutput } from '../shared/agentToolTypes'
import { useIsStreaming } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { extractToolErrorText } from '../toolError'
import { getSessionDeliveryStatus } from './sessionDeliveryStatus'

interface SessionSendInput {
  message?: string
  targetSessionId?: string
}

interface SessionSendResult {
  ok: true
  status?: string
  delivery?: {
    receiver?: { agentId?: string; sessionId?: string }
    receiverSnapshot?: { agentName?: string; sessionName?: string }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonResult(value: unknown): unknown {
  if (isRecord(value) && Array.isArray(value.content)) {
    const text = value.content
      .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n')
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function parseSessionSendResult(value: unknown): SessionSendResult | undefined {
  const candidate = parseJsonResult(value)
  if (!isRecord(candidate) || candidate.ok !== true) return undefined

  const delivery = isRecord(candidate.delivery) ? candidate.delivery : undefined
  const receiver = delivery && isRecord(delivery.receiver) ? delivery.receiver : undefined
  const receiverSnapshot = delivery && isRecord(delivery.receiverSnapshot) ? delivery.receiverSnapshot : undefined

  return {
    ok: true,
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    delivery: delivery
      ? {
          receiver: receiver
            ? {
                agentId: typeof receiver.agentId === 'string' ? receiver.agentId : undefined,
                sessionId: typeof receiver.sessionId === 'string' ? receiver.sessionId : undefined
              }
            : undefined,
          receiverSnapshot: receiverSnapshot
            ? {
                agentName: typeof receiverSnapshot.agentName === 'string' ? receiverSnapshot.agentName : undefined,
                sessionName: typeof receiverSnapshot.sessionName === 'string' ? receiverSnapshot.sessionName : undefined
              }
            : undefined
        }
      : undefined
  }
}

function getInput(input: ToolInput | Record<string, unknown> | undefined): SessionSendInput {
  if (!isRecord(input)) return {}
  const record = input as Record<string, unknown>
  return {
    message: typeof record.message === 'string' ? record.message : undefined,
    targetSessionId: typeof record.target_session_id === 'string' ? record.target_session_id : undefined
  }
}

export function SessionSendTool({
  input,
  output,
  hasError = false
}: {
  input?: ToolInput | Record<string, unknown>
  output?: ToolOutput
  hasError?: boolean
}): ToolDisclosureItem {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const isStreaming = useIsStreaming()
  const sessionInput = getInput(input)
  const result = parseSessionSendResult(output)
  const targetSessionId = result?.delivery?.receiver?.sessionId ?? sessionInput.targetSessionId
  const targetSessionName = result?.delivery?.receiverSnapshot?.sessionName?.trim() || targetSessionId
  const targetAgentName = result?.delivery?.receiverSnapshot?.agentName?.trim()
  const targetLabel = [targetAgentName, targetSessionName].filter(Boolean).join(' / ')
  const message = sessionInput.message?.trim()
  const errorText = hasError ? extractToolErrorText(output) : undefined
  const deliveryStatus = result?.status ? getSessionDeliveryStatus(result.status, t) : undefined

  const openTargetSession = () => {
    if (!targetSessionId || !result || !actions?.navigateToRoute) return
    void actions.navigateToRoute({ path: '/app/agents', query: { sessionId: targetSessionId } })
  }

  return {
    key: SESSION_SEND_TOOL_NAME,
    label: (
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-info-subtle text-info-subtle-foreground">
          <Send aria-hidden="true" size={12} strokeWidth={1.9} />
        </span>
        <span className="shrink-0">
          {isStreaming ? t('message.tools.sessionSend.sending') : t('message.tools.sessionSend.sent')}
        </span>
        {targetLabel ? (
          <span className="truncate text-foreground" title={targetLabel}>
            {targetLabel}
          </span>
        ) : null}
      </div>
    ),
    children: (
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-info-border bg-info-subtle text-info-subtle-foreground">
            <Send aria-hidden="true" size={13} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-foreground-tertiary text-xs">{t('message.tools.sessionSend.to')}</div>
            <div className="truncate font-medium text-foreground text-sm" title={targetLabel}>
              {targetLabel}
            </div>
            {message ? (
              <div className="selectable mt-2 line-clamp-4 whitespace-pre-wrap break-words text-foreground text-sm leading-5">
                {message}
              </div>
            ) : null}
          </div>
          {deliveryStatus ? (
            <Badge
              variant="outline"
              className={`h-5 shrink-0 px-2 py-0 font-medium text-[11px] ${deliveryStatus.className}`}>
              {deliveryStatus.label}
            </Badge>
          ) : null}
        </div>

        {errorText ? (
          <div className="mt-3 rounded-md border border-error-border bg-error-subtle px-2.5 py-2 text-error-subtle-foreground text-xs">
            {errorText}
          </div>
        ) : null}

        {targetSessionId && result && actions?.navigateToRoute ? (
          <div className="mt-3 flex justify-end border-border-subtle border-t pt-2.5">
            <Button type="button" variant="outline" size="sm" onClick={openTargetSession}>
              {t('message.tools.sessionSend.open')}
              <ArrowUpRight aria-hidden="true" size={13} />
            </Button>
          </div>
        ) : null}
      </div>
    ),
    classNames: {
      body: 'max-h-[28rem] border border-border-subtle bg-background-subtle px-3 py-3'
    }
  }
}
