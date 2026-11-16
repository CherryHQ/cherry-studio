import { ArrowUpRight, ChevronDown, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { type ComponentType, useCallback, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import { ScrollArea } from '@cherrystudio/ui'
import { Button, Kbd, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import {
  isValidAgentToolsType,
  renderTool,
  TerminalOutput,
  UnknownToolRenderer
} from '@renderer/components/chat/messages/tools/agent'
import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import { ToolArgsTable } from '@renderer/components/chat/messages/tools/shared/ArgsTable'
import { ToolDisclosure, type ToolDisclosureItem } from '@renderer/components/chat/messages/tools/shared/ToolDisclosure'
import type { ToolResponseLike } from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import CopyButton from '@renderer/components/CopyButton'
import { toast } from '@renderer/services/toast'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { cn } from '@renderer/utils/style'

import type { ComposerOverride } from '../ComposerContext'
import type { PermissionRequestComposerRequest } from './permissionRequestComposerRequest'
import { getPermissionRiskEffects, type PermissionRiskEffect } from './permissionRisk'

export type { PermissionRequestComposerRequest } from './permissionRequestComposerRequest'
export { findNextPendingPermissionRequest } from './permissionRequestComposerRequest'

const logger = loggerService.withContext('PermissionRequestComposer')

function isHandledElsewhere(event: KeyboardEvent) {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    (event.key === 'Enter' && event.target instanceof Element && !!event.target.closest('button, [role="button"]'))
  )
}

export type PermissionRequestComposerProps = {
  request: PermissionRequestComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  className?: string
  agentName?: string
  onOpenSource?: (source: NonNullable<PermissionRequestComposerRequest['source']>) => void
}

type PermissionRequestComposerOverrideOptions = {
  request: PermissionRequestComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  component?: ComponentType<PermissionRequestComposerProps>
  agentName?: string
}

function isMcpToolResponse(toolResponse: ToolResponseLike): toolResponse is McpToolResponse {
  return toolResponse.tool.type === 'mcp'
}

function normalizeArgs(args: ToolResponseLike['arguments']): Record<string, unknown> | unknown[] | null {
  if (args === undefined || args === null) return null
  if (typeof args === 'object') return args
  return { value: args }
}

const BUILTIN_TOOLS_WITH_OWN_PREVIEW_SCROLL = new Set<string>([
  AgentToolsType.Bash,
  AgentToolsType.BashOutput,
  AgentToolsType.Glob,
  AgentToolsType.Grep,
  AgentToolsType.Read,
  AgentToolsType.Skill,
  AgentToolsType.Write
])

function renderBuiltinPreviewChildren(toolName: string, children: ToolDisclosureItem['children']) {
  if (children === undefined || children === null || BUILTIN_TOOLS_WITH_OWN_PREVIEW_SCROLL.has(toolName)) {
    return children
  }

  return (
    <ScrollArea
      viewportProps={{ className: 'overflow-x-hidden', 'data-testid': 'permission-builtin-body-scroll' }}
      className="max-h-60">
      {children}
    </ScrollArea>
  )
}

export function createPermissionRequestComposerOverride({
  request,
  onRespond,
  component: Component = PermissionRequestComposer,
  agentName
}: PermissionRequestComposerOverrideOptions): ComposerOverride {
  return {
    id: `tool-permission:${request.approvalId}`,
    priority: 90,
    render: ({ className }) => (
      <Component request={request} onRespond={onRespond} className={className} agentName={agentName} />
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
    children: renderBuiltinPreviewChildren(toolName, renderedItem.children),
    classNames: {
      ...renderedItem.classNames,
      header: cn('px-3 py-2', renderedItem.classNames?.header),
      body: cn('max-h-none overflow-visible bg-transparent p-2 text-foreground', renderedItem.classNames?.body)
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

function McpPermissionPreview({ toolResponse }: { toolResponse: McpToolResponse }) {
  const { t } = useTranslation()
  const args = normalizeArgs(toolResponse.arguments)

  return (
    <div className="px-3 py-2">
      <PermissionPreviewHeader toolName={toolResponse.tool.name} description={toolResponse.tool.description} />
      {args ? (
        <ScrollArea
          viewportProps={{ className: 'overflow-x-hidden', 'data-testid': 'permission-mcp-args-scroll' }}
          className="max-h-60">
          <ToolArgsTable args={args} title={t('message.tools.sections.input')} />
        </ScrollArea>
      ) : (
        <div className="py-2 text-muted-foreground text-xs">{t('message.tools.noData')}</div>
      )}
    </div>
  )
}

function PermissionPreview({ toolResponse }: { toolResponse: ToolResponseLike }) {
  const { t } = useTranslation()
  const args = toolResponse.arguments
  const command =
    args && typeof args === 'object' && 'command' in args && typeof args.command === 'string' ? args.command : undefined
  if (
    !isMcpToolResponse(toolResponse) &&
    ['Bash', 'bash', 'pwsh', 'powershell'].includes(toolResponse.tool.name) &&
    command
  ) {
    return (
      <div className="px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground text-xs">
          <span>{t('message.tools.sections.command')}</span>
          <CopyButton textToCopy={command} tooltip={t('common.copy')} successFeedback="icon" />
        </div>
        <TerminalOutput content={command} commandMode maxHeight="10rem" />
      </div>
    )
  }
  if (isMcpToolResponse(toolResponse)) {
    return <McpPermissionPreview toolResponse={toolResponse} />
  }

  return <BuiltinPermissionPreview toolResponse={toolResponse} />
}

function getPermissionRequestSubtitle(request: PermissionRequestComposerRequest): string | null {
  const title = request.title.trim()
  const toolName = request.toolResponse.tool.name.trim()

  if (!title || title === toolName) return null
  return title
}

function PermissionPreviewHeader({ toolName, description }: { toolName: string; description?: string }) {
  return (
    <div className="min-w-0 text-foreground text-sm">
      <div className="truncate font-medium">{toolName}</div>
      {description ? (
        <div className="mt-0.5 line-clamp-2 text-muted-foreground text-xs leading-4">{description}</div>
      ) : null}
    </div>
  )
}

const RISK_EFFECT_TONE: Record<PermissionRiskEffect, string> = {
  destructive: 'text-destructive',
  irreversible: 'text-destructive',
  network: 'text-warning'
}

function PermissionRiskSummary({ toolName, args }: { toolName: string; args: unknown }) {
  const { t } = useTranslation()
  const effects = getPermissionRiskEffects(toolName, args)
  if (effects.length === 0) return null
  const effectLabels: Record<PermissionRiskEffect, string> = {
    destructive: t('agent.toolPermission.risk.destructive'),
    irreversible: t('agent.toolPermission.risk.irreversible'),
    network: t('agent.toolPermission.risk.network')
  }

  return (
    <div
      data-testid="permission-risk-summary"
      className="mt-2 rounded-[12px] border border-border bg-background px-3 py-2">
      <div className="font-medium text-muted-foreground text-xs">{t('agent.toolPermission.risk.title')}</div>
      <ul className="mt-1 space-y-0.5">
        {effects.map((effect) => (
          <li key={effect} className={`flex items-start gap-1.5 text-xs leading-4 ${RISK_EFFECT_TONE[effect]}`}>
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
            {effectLabels[effect]}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function PermissionRequestComposer({
  request,
  onRespond,
  className,
  agentName,
  onOpenSource
}: PermissionRequestComposerProps) {
  const { t } = useTranslation()
  const [submittingApprovalId, setSubmittingApprovalId] = useState<string | null>(null)
  const [rejectionDraft, setRejectionDraft] = useState({ approvalId: request.approvalId, value: '', expanded: false })
  const reasonExpanded = rejectionDraft.approvalId === request.approvalId && rejectionDraft.expanded
  const isSubmitting = submittingApprovalId === request.approvalId
  const rejectionReason = rejectionDraft.approvalId === request.approvalId ? rejectionDraft.value : ''
  // A typed reason means the user is denying — Enter must not approve behind their back.
  const hasRejectionReason = rejectionReason.trim().length > 0
  const subtitle = getPermissionRequestSubtitle(request)

  const respond = useCallback(
    async (input: MessageToolApprovalInput, action: 'approve' | 'deny') => {
      const approvalId = request.approvalId
      setSubmittingApprovalId(approvalId)
      try {
        await onRespond(input)
      } catch (error) {
        logger.error('Failed to send permission response', error as Error, {
          action,
          approvalId
        })
        toast.error(t('agent.toolPermission.error.sendFailed'))
        setSubmittingApprovalId((current) => (current === approvalId ? null : current))
      }
    },
    [onRespond, request.approvalId, t]
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
    const reason = rejectionReason.trim() || undefined
    await respond(
      {
        match: request.match,
        approved: false,
        reason
      },
      'deny'
    )
  }, [isSubmitting, rejectionReason, request.match, respond])

  useHotkeys(
    'enter',
    () => void (hasRejectionReason ? deny() : approve()),
    { preventDefault: true, ignoreEventWhen: isHandledElsewhere },
    [approve, deny, hasRejectionReason]
  )
  useHotkeys('esc', () => void deny(), { preventDefault: true, ignoreEventWhen: isHandledElsewhere }, [deny])

  return (
    <div
      data-composer-viewport-inset-target=""
      // pointer-events-auto: the composer dock stack is click-through; override
      // composers re-enable interaction on their own root.
      className={cn('pointer-events-auto relative z-2 flex flex-col px-4.5 pt-0 pb-4.5', className)}>
      <div
        className="rounded-[17px] border-[0.5px] border-border p-2.5 shadow-[0_1px_5px_rgba(15,23,42,0.05)] backdrop-blur dark:shadow-[0_1px_5px_rgba(0,0,0,0.14)]"
        style={{ backgroundColor: 'color-mix(in srgb, var(--background) 88%, transparent)' }}>
        <div className="flex min-w-0 items-center gap-2 px-1">
          <h2 className="flex shrink-0 items-center gap-2 font-semibold text-foreground text-sm leading-5">
            <span className="inline-flex shrink-0 text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="size-4" />
            </span>
            {t('agent.toolPermission.title')}
          </h2>
          {/* Live region stays mounted while idle so injecting the processing pill is announced */}
          <div role="status" aria-live="polite" className="ml-auto shrink-0">
            {isSubmitting ? (
              <div className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 font-medium text-[11px] text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                {t('message.processing')}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-muted-foreground text-xs">
          <span>{t('agent.toolPermission.source')}</span>
          {request.source ? (
            <>
              <span>{t('agent.toolPermission.subagent')}</span>
              {onOpenSource ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto min-w-0 max-w-full justify-start gap-1 p-0 text-link text-xs"
                  onClick={() => onOpenSource(request.source!)}>
                  <span className="truncate">{request.source.title || t('agent.toolPermission.subagent')}</span>
                  <ArrowUpRight aria-hidden="true" className="size-3 shrink-0" />
                </Button>
              ) : (
                <span className="min-w-0 break-words text-foreground">{request.source.title}</span>
              )}
              {request.source.isBackgrounded ? (
                <span className="rounded bg-muted px-1.5 py-0.5">{t('agent.toolPermission.background')}</span>
              ) : null}
            </>
          ) : (
            <span className="text-foreground">{agentName || t('common.agent')}</span>
          )}
        </div>
        {subtitle ? <p className="mt-1 break-words px-1 text-muted-foreground text-xs">{subtitle}</p> : null}
        <PermissionRiskSummary toolName={request.toolResponse.tool.name} args={request.toolResponse.arguments} />
        <div className="mt-2 overflow-hidden rounded-[12px] bg-muted dark:bg-muted/30" data-testid="permission-preview">
          <PermissionPreview toolResponse={request.toolResponse} />
        </div>

        <div className="mt-2 px-1">
          <Button
            type="button"
            variant="ghost"
            disabled={isSubmitting}
            aria-expanded={reasonExpanded}
            className="h-auto gap-1 px-0 py-1 text-muted-foreground text-xs"
            onClick={() =>
              setRejectionDraft({ approvalId: request.approvalId, value: rejectionReason, expanded: !reasonExpanded })
            }>
            <ChevronDown aria-hidden="true" className={cn('size-3', reasonExpanded && 'rotate-180')} />
            {t('agent.toolPermission.reasonLabel')}
          </Button>
          {reasonExpanded ? (
            <Textarea.Input
              value={rejectionReason}
              disabled={isSubmitting}
              maxLength={500}
              rows={2}
              aria-label={t('agent.toolPermission.reasonLabel')}
              placeholder={t('agent.toolPermission.reasonPlaceholder')}
              className="mt-1 min-h-14 resize-none px-3 py-2 text-sm"
              onValueChange={(value) => setRejectionDraft({ approvalId: request.approvalId, value, expanded: true })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                void (hasRejectionReason ? deny() : approve())
              }}
            />
          ) : null}
        </div>

        <div className="mt-2.5 flex justify-end gap-2 px-1 pb-0.5">
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => void deny()}>
            {t('agent.toolPermission.button.deny')}
            <Kbd aria-hidden="true" className="bg-muted text-muted-foreground">
              {hasRejectionReason ? 'Enter' : 'Esc'}
            </Kbd>
          </Button>
          <Button type="button" variant="emphasis" disabled={isSubmitting} onClick={() => void approve()}>
            {t('agent.toolPermission.button.allow')}
            {!hasRejectionReason && (
              <Kbd aria-hidden="true" className="bg-current/10 text-current">
                Enter
              </Kbd>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
