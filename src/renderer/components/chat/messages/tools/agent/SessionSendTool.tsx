import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@cherrystudio/ui'
import { SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'

import type { ToolInput, ToolOutput } from '../shared/agentToolTypes'
import type { ToolStatus } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { extractToolErrorText } from '../toolError'
import { getSessionDeliveryStatus } from './sessionDeliveryStatus'
import { parseSessionSendResult } from './sessionToolResult'

interface SessionSendInput {
  message?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getInput(input: ToolInput | Record<string, unknown> | undefined): SessionSendInput {
  if (!isRecord(input)) return {}
  const record = input as Record<string, unknown>
  return {
    message: typeof record.message === 'string' ? record.message : undefined
  }
}

export function SessionSendTool({
  input,
  output,
  hasError = false,
  isStreaming = false,
  status
}: {
  input?: ToolInput | Record<string, unknown>
  output?: ToolOutput
  hasError?: boolean
  isStreaming?: boolean
  status?: ToolStatus
}): ToolDisclosureItem {
  const { t } = useTranslation()
  const sessionInput = getInput(input)
  const result = parseSessionSendResult(output)
  const targetSessionName = result
    ? result.delivery?.receiverSnapshot?.sessionName?.trim() || t('message.tools.sessionCreate.untitled')
    : undefined
  const targetAgentName = result?.delivery?.receiverSnapshot?.agentName?.trim()
  const targetLabel = [targetAgentName, targetSessionName].filter(Boolean).join(' / ')
  const message = sessionInput.message?.trim()
  const errorText = hasError ? extractToolErrorText(output) : undefined
  const deliveryStatus = result?.status ? getSessionDeliveryStatus(result.status, t) : undefined
  const actionLabel = isStreaming
    ? t('message.tools.sessionSend.sending')
    : status === 'cancelled'
      ? t('message.tools.cancelled')
      : hasError || status === 'error'
        ? t('message.tools.error')
        : t('message.tools.sessionSend.sent')

  return {
    key: SESSION_SEND_TOOL_NAME,
    label: (
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-info-subtle text-info-subtle-foreground">
          <Send aria-hidden="true" size={12} strokeWidth={1.9} />
        </span>
        <span className="shrink-0">{actionLabel}</span>
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
            {targetLabel ? (
              <>
                <div className="text-foreground-tertiary text-xs">{t('message.tools.sessionSend.to')}</div>
                <div className="truncate font-medium text-foreground text-sm" title={targetLabel}>
                  {targetLabel}
                </div>
              </>
            ) : null}
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
      </div>
    ),
    classNames: {
      body: 'max-h-[28rem] border border-border-subtle bg-background-subtle px-3 py-3'
    }
  }
}
