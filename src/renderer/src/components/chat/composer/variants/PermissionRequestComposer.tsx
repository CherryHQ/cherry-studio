import { Button } from '@cherrystudio/ui'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import type { MCPToolResponse, NormalToolResponse } from '@renderer/types'
import { cn } from '@renderer/utils/style'
import { AlertTriangle, ArrowRight, Wrench } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isValidAgentToolsType, renderTool } from '../../messages/tools/agent'
import { UnknownToolRenderer } from '../../messages/tools/agent/UnknownToolRenderer'
import { ToolArgsTable } from '../../messages/tools/shared/ArgsTable'
import { ToolDisclosure, type ToolDisclosureItem } from '../../messages/tools/shared/ToolDisclosure'
import type { ToolResponseLike } from '../../messages/tools/toolResponse'
import type { ComposerOverride } from '../ComposerContext'
import type { PermissionRequestComposerRequest } from './PermissionRequestComposerRequest'
export type { PermissionRequestComposerRequest } from './PermissionRequestComposerRequest'
export { findLatestPendingPermissionRequest } from './PermissionRequestComposerRequest'

type PermissionRequestComposerProps = {
  request: PermissionRequestComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  className?: string
}

type PermissionRequestComposerOverrideOptions = {
  request: PermissionRequestComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
}

function isMcpToolResponse(toolResponse: ToolResponseLike): toolResponse is MCPToolResponse {
  return toolResponse.tool.type === 'mcp'
}

function normalizeArgs(args: ToolResponseLike['arguments']): Record<string, unknown> | unknown[] | null {
  if (args === undefined || args === null) return null
  if (typeof args === 'object') return args as Record<string, unknown> | unknown[]
  return { value: args }
}

export function createPermissionRequestComposerOverride({
  request,
  onRespond
}: PermissionRequestComposerOverrideOptions): ComposerOverride {
  return {
    id: `tool-permission:${request.approvalId}`,
    priority: 90,
    render: ({ className }) => (
      <PermissionRequestComposer request={request} onRespond={onRespond} className={className} />
    )
  }
}

function BuiltinPermissionPreview({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const toolName = toolResponse.tool.name
  const input = toolResponse.arguments as Record<string, unknown> | string | undefined
  const renderedItem = isValidAgentToolsType(toolName)
    ? renderTool(toolName, input)
    : UnknownToolRenderer({ toolName, input })

  const item: ToolDisclosureItem = {
    ...renderedItem,
    label: <PermissionPreviewHeader toolName={toolName} />,
    classNames: {
      ...renderedItem.classNames,
      header: cn('px-3 py-2', renderedItem.classNames?.header),
      body: cn('max-h-56 overflow-auto bg-transparent p-2 text-foreground', renderedItem.classNames?.body)
    }
  }

  return (
    <ToolDisclosure
      className="w-full"
      variant="light"
      defaultActiveKey={[String(renderedItem.key ?? toolName)]}
      items={[item]}
    />
  )
}

function McpPermissionPreview({ toolResponse }: { toolResponse: MCPToolResponse }) {
  const { t } = useTranslation()
  const args = normalizeArgs(toolResponse.arguments)

  return (
    <div className="px-3 py-2">
      <PermissionPreviewHeader toolName={toolResponse.tool.name} />
      {args ? (
        <ToolArgsTable args={args} title={t('message.tools.sections.input')} />
      ) : (
        <div className="py-2 text-muted-foreground text-xs">{t('message.tools.noData')}</div>
      )}
    </div>
  )
}

function PermissionPreview({ toolResponse }: { toolResponse: ToolResponseLike }) {
  if (isMcpToolResponse(toolResponse)) {
    return <McpPermissionPreview toolResponse={toolResponse} />
  }

  return <BuiltinPermissionPreview toolResponse={toolResponse} />
}

function PermissionPreviewHeader({ toolName }: { toolName: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-foreground text-sm">
      <Wrench className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{toolName}</span>
    </div>
  )
}

function PermissionOption({
  index,
  label,
  ariaLabel,
  destructive,
  disabled,
  selected,
  onSelect
}: {
  index: number
  label: string
  ariaLabel: string
  destructive?: boolean
  disabled: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'group h-auto min-h-11 w-full justify-start gap-3 whitespace-normal rounded-[12px] px-3 py-2 text-left shadow-none',
        'hover:bg-muted focus-visible:bg-muted',
        selected && 'bg-muted'
      )}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={selected}
      onClick={onSelect}>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full font-semibold text-sm transition-colors',
          selected
            ? 'bg-neutral-950 text-white dark:bg-neutral-50 dark:text-neutral-950'
            : 'bg-muted text-muted-foreground group-hover:bg-neutral-950 group-hover:text-white dark:group-hover:bg-neutral-50 dark:group-hover:text-neutral-950'
        )}>
        {index}
      </span>

      <span
        className={cn(
          'block min-w-0 flex-1 truncate font-semibold text-foreground text-sm leading-5',
          destructive && 'text-destructive'
        )}>
        {label}
      </span>

      <ArrowRight
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      />
    </Button>
  )
}

export default function PermissionRequestComposer({ request, onRespond, className }: PermissionRequestComposerProps) {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedAction, setSelectedAction] = useState<'approve' | 'deny' | null>(null)
  const title = useMemo(() => request.title || t('agent.toolPermission.confirmation'), [request.title, t])

  const respond = useCallback(
    async (input: MessageToolApprovalInput, action: 'approve' | 'deny') => {
      setSelectedAction(action)
      setIsSubmitting(true)
      try {
        await onRespond(input)
      } catch {
        window.toast.error(t('agent.toolPermission.error.sendFailed'))
        setSelectedAction(null)
        setIsSubmitting(false)
      }
    },
    [onRespond, t]
  )

  const approve = useCallback(async () => {
    if (isSubmitting) return
    await respond(
      {
        match: request.match,
        approved: true
      },
      'approve'
    )
  }, [isSubmitting, request.match, respond])

  const deny = useCallback(async () => {
    if (isSubmitting) return
    await respond(
      {
        match: request.match,
        approved: false,
        reason: t('agent.toolPermission.defaultDenyMessage')
      },
      'deny'
    )
  }, [isSubmitting, request.match, respond, t])

  return (
    <div className={cn('relative z-2 flex flex-col px-4.5 pt-0 pb-4.5 in-[[navbar-position=top]]:pb-2.5', className)}>
      <div className="rounded-[17px] border-border border-[0.5px] bg-(--color-background-opacity) p-2.5 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="line-clamp-1 flex min-w-0 flex-1 items-center gap-2 font-semibold text-foreground text-sm leading-5">
            <AlertTriangle className="size-4 shrink-0 text-warning" />
            <span className="truncate">{title}</span>
          </h2>
          <div className="rounded-full bg-warning/10 px-2 py-1 font-medium text-[11px] text-warning">
            {t('agent.toolPermission.pending')}
          </div>
        </div>

        <div className="mt-2 overflow-hidden rounded-[12px] bg-muted/30">
          <PermissionPreview toolResponse={request.toolResponse} />
        </div>

        <div className="mt-2 flex flex-col gap-1.5">
          <PermissionOption
            index={1}
            label={t('agent.toolPermission.button.allow')}
            ariaLabel={t('agent.toolPermission.button.allow')}
            disabled={isSubmitting}
            selected={selectedAction === 'approve'}
            onSelect={() => void approve()}
          />
          <PermissionOption
            index={2}
            label={t('agent.toolPermission.button.deny')}
            ariaLabel={t('agent.toolPermission.button.deny')}
            destructive
            disabled={isSubmitting}
            selected={selectedAction === 'deny'}
            onSelect={() => void deny()}
          />
        </div>
      </div>
    </div>
  )
}
