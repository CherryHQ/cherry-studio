import { Badge, Button, Tooltip } from '@cherrystudio/ui'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { SESSION_CREATE_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { Check, Copy, GitBranchPlus, MessageSquareText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import type { ToolInput, ToolOutput } from '../shared/agentToolTypes'
import { useIsStreaming } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { extractToolErrorText } from '../toolError'
import { getSessionDeliveryStatus } from './sessionDeliveryStatus'
import { parseSessionCreateResult } from './sessionToolResult'

interface SessionCreateInput {
  message?: string
  title?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getInput(input: ToolInput | Record<string, unknown> | undefined): SessionCreateInput {
  if (!isRecord(input)) return {}
  const record = input as Record<string, unknown>
  return {
    message: typeof record.message === 'string' ? record.message : undefined,
    title: typeof record.title === 'string' ? record.title : undefined
  }
}

export function SessionCreateTool({
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
  const [copied, setCopied] = useTemporaryValue(false)
  const isStreaming = useIsStreaming()
  const sessionInput = getInput(input)
  const result = parseSessionCreateResult(output)
  const title = sessionInput.title?.trim() || t('message.tools.sessionCreate.untitled')
  const message = sessionInput.message?.trim()
  const deliveryStatus = getSessionDeliveryStatus(result?.delivery?.status, t)
  const errorText = hasError ? extractToolErrorText(output) : undefined

  const copySessionId = () => {
    if (!result?.sessionId || !actions?.copyText) return
    Promise.resolve(actions.copyText(result.sessionId, { successMessage: t('common.copied') }))
      .then(() => setCopied(true))
      .catch(() => actions.notifyError?.(t('message.copy.failed')))
  }

  return {
    key: SESSION_CREATE_TOOL_NAME,
    label: (
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-info-subtle text-info-subtle-foreground">
          <GitBranchPlus aria-hidden="true" size={13} strokeWidth={1.9} />
        </span>
        <span className="shrink-0">
          {isStreaming ? t('message.tools.sessionCreate.creating') : t('message.tools.sessionCreate.created')}
        </span>
        <span className="truncate text-foreground" title={title}>
          {title}
        </span>
      </div>
    ),
    children: (
      <div className="min-w-0">
        <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3">
          <div className="flex flex-col items-center">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-info-border bg-info-subtle text-info-subtle-foreground">
              <GitBranchPlus aria-hidden="true" size={11} strokeWidth={2} />
            </span>
            <span className="my-1 min-h-4 w-px flex-1 bg-border-subtle" />
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
              <MessageSquareText aria-hidden="true" size={10} strokeWidth={2} />
            </span>
          </div>

          <div className="min-w-0 pb-3">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground text-sm" title={title}>
                  {title}
                </div>
                <div className="mt-0.5 text-foreground-tertiary text-xs">
                  {t('message.tools.sessionCreate.inheritedContext')}
                </div>
              </div>
              {result ? (
                <Badge
                  variant="outline"
                  className={`h-5 shrink-0 px-2 py-0 font-medium text-[11px] ${deliveryStatus.className}`}>
                  {deliveryStatus.label}
                </Badge>
              ) : null}
            </div>
          </div>

          <div />
          <div className="min-w-0">
            <div className="mb-1 font-medium text-muted-foreground text-xs">
              {t('message.tools.sessionCreate.firstMessage')}
            </div>
            {message ? (
              <div className="selectable line-clamp-4 whitespace-pre-wrap break-words text-foreground text-sm leading-5">
                {message}
              </div>
            ) : null}
          </div>
        </div>

        {errorText ? (
          <div className="mt-3 rounded-md border border-error-border bg-error-subtle px-2.5 py-2 text-error-subtle-foreground text-xs">
            {errorText}
          </div>
        ) : null}

        {result?.sessionId ? (
          <div className="mt-3 flex min-w-0 items-center gap-2 border-border-subtle border-t pt-2.5">
            <span className="shrink-0 text-foreground-tertiary text-xs">
              {t('message.tools.sessionCreate.sessionId')}
            </span>
            <code className="selectable min-w-0 flex-1 truncate text-foreground text-xs" title={result.sessionId}>
              {result.sessionId}
            </code>
            {actions?.copyText ? (
              <Tooltip content={copied ? t('common.copied') : t('common.copy')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={copied ? t('common.copied') : t('common.copy')}
                  onClick={copySessionId}>
                  {copied ? (
                    <Check aria-hidden="true" size={13} className="text-success" />
                  ) : (
                    <Copy aria-hidden="true" size={13} />
                  )}
                </Button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
    ),
    classNames: {
      body: 'max-h-[28rem] border border-border-subtle bg-background-subtle px-3 py-3'
    }
  }
}
