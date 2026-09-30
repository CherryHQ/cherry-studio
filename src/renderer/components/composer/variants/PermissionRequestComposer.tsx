import { Loader2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import { Button, Kbd, Textarea } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { getToolGroupIcon, getToolGroupSemanticTitle } from '@renderer/components/chat/messages/blocks/ToolBlockGroup'
import { isValidAgentToolsType, renderTool, UnknownToolRenderer } from '@renderer/components/chat/messages/tools/agent'
import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import { ToolArgsTable } from '@renderer/components/chat/messages/tools/shared/ArgsTable'
import { ToolDisclosure, type ToolDisclosureItem } from '@renderer/components/chat/messages/tools/shared/ToolDisclosure'
import type { ToolResponseLike } from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import Scrollbar from '@renderer/components/Scrollbar'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { cn } from '@renderer/utils/style'
import { isPlanExitToolName } from '@shared/ai/tool'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import type { ComposerOverride } from '../ComposerContext'
import type { PermissionRequestComposerRequest } from './permissionRequestComposerRequest'

export type { PermissionRequestComposerRequest } from './permissionRequestComposerRequest'
export { findNextPendingPermissionRequest } from './permissionRequestComposerRequest'

const logger = loggerService.withContext('PermissionRequestComposer')

function isHandledElsewhere(event: KeyboardEvent) {
  return event.defaultPrevented || event.isComposing
}

/**
 * Agent-surface gates for the Settings-configured plan-execution model. Absent on the Home path,
 * which has no agent whose model a handoff could switch — there is nothing to hand off to.
 */
export type PlanExecutionHandoffOptions = {
  /** The agent's runtime-compatibility gate; an unrunnable model must never be handed off to. */
  modelFilter?: ModelSelectorFilter
  /** The availability gate; a model Cherry Cloud marks unavailable must not be handed off to. */
  isModelDisabled?: ModelSelectorFilter
}

type PermissionRequestComposerProps = {
  request: PermissionRequestComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  planExecution?: PlanExecutionHandoffOptions
  className?: string
}

type PermissionRequestComposerOverrideOptions = {
  request: PermissionRequestComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  planExecution?: PlanExecutionHandoffOptions
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
    <Scrollbar className="max-h-60 overflow-x-hidden" data-testid="permission-builtin-body-scroll">
      {children}
    </Scrollbar>
  )
}

export function createPermissionRequestComposerOverride({
  request,
  onRespond,
  planExecution
}: PermissionRequestComposerOverrideOptions): ComposerOverride {
  return {
    id: `tool-permission:${request.approvalId}`,
    priority: 90,
    render: ({ className }) => (
      <PermissionRequestComposer
        request={request}
        onRespond={onRespond}
        planExecution={planExecution}
        className={className}
      />
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
        <Scrollbar className="max-h-60 overflow-x-hidden" data-testid="permission-mcp-args-scroll">
          <ToolArgsTable args={args} title={t('message.tools.sections.input')} />
        </Scrollbar>
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

export default function PermissionRequestComposer({
  request,
  onRespond,
  planExecution,
  className
}: PermissionRequestComposerProps) {
  const { t } = useTranslation()
  const [submittingApprovalId, setSubmittingApprovalId] = useState<string | null>(null)
  const [rejectionDraft, setRejectionDraft] = useState({ approvalId: request.approvalId, value: '' })
  const [configuredExecutionModelId] = usePreference('chat.plan_execution.model_id')
  const { model: configuredExecutionModel } = useModelById(configuredExecutionModelId as UniqueModelId | undefined)
  const { providers } = useProviders({ enabled: true })
  // Main's handoff gate is name-based too, but an MCP tool that merely shares the plan-exit name
  // carries no plan semantics — an approval like that must never send an executionModelId.
  const isPlanExitApproval =
    !isMcpToolResponse(request.toolResponse) && isPlanExitToolName(request.toolResponse.tool.name)
  // Settings → Default models picks the execution model; the gates decide whether it may be handed
  // off to here. They are called with the model's Provider because several runtime compatibility
  // predicates are provider-aware and fail closed without one.
  const handoffModel = useMemo(() => {
    if (!planExecution || !isPlanExitApproval || !configuredExecutionModel) return undefined
    const provider = providers.find((candidate) => candidate.id === configuredExecutionModel.providerId)
    if (planExecution.modelFilter && !planExecution.modelFilter(configuredExecutionModel, provider)) return undefined
    if (planExecution.isModelDisabled && planExecution.isModelDisabled(configuredExecutionModel, provider))
      return undefined
    return configuredExecutionModel
  }, [configuredExecutionModel, isPlanExitApproval, planExecution, providers])
  const configuredModelLabel = configuredExecutionModel?.name ?? configuredExecutionModelId ?? ''
  const isSubmitting = submittingApprovalId === request.approvalId
  const rejectionReason = rejectionDraft.approvalId === request.approvalId ? rejectionDraft.value : ''
  // A typed reason means the user is denying — Enter must not approve behind their back.
  const hasRejectionReason = rejectionReason.trim().length > 0
  const subtitle = getPermissionRequestSubtitle(request)
  const ToolIcon = getToolGroupIcon(request.toolResponse.tool, request.toolResponse.arguments)
  const toolTitle = getToolGroupSemanticTitle(request.toolResponse, 'waiting', t)

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
    // A handoff belongs to a plan approval alone: Main refuses one for any other tool, and a
    // malformed id would stop the approved turn without a usable follow-up — only send real ones.
    const handoffModelId =
      isPlanExitApproval && handoffModel && isUniqueModelId(handoffModel.id) ? handoffModel.id : undefined
    await respond(
      {
        match: request.match,
        approved: true,
        ...(handoffModelId ? { executionModelId: handoffModelId } : {})
      },
      'approve'
    )
  }, [handoffModel, isPlanExitApproval, isSubmitting, request.match, respond])

  const deny = useCallback(async () => {
    if (isSubmitting) return
    const reason = rejectionReason.trim() || t('agent.toolPermission.defaultDenyMessage')
    await respond(
      {
        match: request.match,
        approved: false,
        reason
      },
      'deny'
    )
  }, [isSubmitting, rejectionReason, request.match, respond, t])

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
              <ToolIcon aria-hidden="true" className="size-4" />
            </span>
            {toolTitle}
          </h2>
          {subtitle ? <span className="min-w-0 truncate text-muted-foreground text-xs">{subtitle}</span> : null}
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

        <div className="mt-2 overflow-hidden rounded-[12px] bg-muted dark:bg-muted/30" data-testid="permission-preview">
          <PermissionPreview toolResponse={request.toolResponse} />
        </div>

        {/* The handoff rewrites the agent's model, so the plan's execution model must be visible
            before the approval — and so must a configured model the gates will not hand off to. */}
        {isPlanExitApproval && planExecution && configuredExecutionModelId ? (
          <p className="mt-2.5 px-1 text-muted-foreground text-xs" data-testid="plan-execution-model">
            {handoffModel
              ? t('agent.toolPermission.executionModel.notice', { model: handoffModel.name })
              : t('agent.toolPermission.executionModel.unavailable', { model: configuredModelLabel })}
          </p>
        ) : null}

        <label className="mt-2.5 block px-1 text-muted-foreground text-xs">
          <span>{t('agent.toolPermission.reasonLabel')}</span>
          <Textarea.Input
            value={rejectionReason}
            disabled={isSubmitting}
            maxLength={500}
            rows={2}
            aria-label={t('agent.toolPermission.reasonLabel')}
            placeholder={t('agent.toolPermission.reasonPlaceholder')}
            className="mt-1 min-h-14 resize-none px-3 py-2 text-sm"
            onValueChange={(value) => setRejectionDraft({ approvalId: request.approvalId, value })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              void (hasRejectionReason ? deny() : approve())
            }}
          />
        </label>

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
