import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { isValidAgentToolsType, renderTool, UnknownToolRenderer } from '@renderer/components/chat/messages/tools/agent'
import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'
import { ToolArgsTable } from '@renderer/components/chat/messages/tools/shared/ArgsTable'
import { ToolDisclosure, type ToolDisclosureItem } from '@renderer/components/chat/messages/tools/shared/ToolDisclosure'
import type { ToolResponseLike } from '@renderer/components/chat/messages/tools/toolResponse'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import Scrollbar from '@renderer/components/Scrollbar'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { cn } from '@renderer/utils/style'
import { Wrench } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerOverride } from '../ComposerContext'
import type { PermissionRequestComposerRequest } from './permissionRequestComposerRequest'

export type { PermissionRequestComposerRequest } from './permissionRequestComposerRequest'
export { findLatestPendingPermissionRequest } from './permissionRequestComposerRequest'

const logger = loggerService.withContext('PermissionRequestComposer')

type PermissionRequestComposerProps = {
  request: PermissionRequestComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
  className?: string
  forceNarrowLayout?: boolean
}

type PermissionRequestComposerOverrideOptions = {
  request: PermissionRequestComposerRequest
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
}

function isMcpToolResponse(toolResponse: ToolResponseLike): toolResponse is McpToolResponse {
  return toolResponse.tool.type === 'mcp'
}

function normalizeArgs(args: ToolResponseLike['arguments']): Record<string, unknown> | unknown[] | null {
  if (args === undefined || args === null) return null
  if (typeof args === 'object') return args as Record<string, unknown> | unknown[]
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
    <Scrollbar className="max-h-36 overflow-x-hidden" data-testid="permission-builtin-body-scroll">
      {children}
    </Scrollbar>
  )
}

export function createPermissionRequestComposerOverride({
  request,
  onRespond
}: PermissionRequestComposerOverrideOptions): ComposerOverride {
  return {
    id: `tool-permission:${request.approvalId}`,
    priority: 90,
    render: ({ className, forceNarrowLayout }) => (
      <PermissionRequestComposer
        request={request}
        onRespond={onRespond}
        className={className}
        forceNarrowLayout={forceNarrowLayout}
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
      header: cn('px-2 py-1', renderedItem.classNames?.header),
      body: cn('max-h-none overflow-visible bg-transparent p-1.5 text-foreground', renderedItem.classNames?.body)
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
    <div className="px-2 py-1.5">
      <PermissionPreviewHeader toolName={toolResponse.tool.name} description={toolResponse.tool.description} />
      {args ? (
        <Scrollbar className="max-h-36 overflow-x-hidden" data-testid="permission-mcp-args-scroll">
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
    <div className="min-w-0 text-[13px] text-foreground">
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
  className,
  forceNarrowLayout = false
}: PermissionRequestComposerProps) {
  const { t } = useTranslation()
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const subtitle = getPermissionRequestSubtitle(request)

  const respond = useCallback(
    async (input: MessageToolApprovalInput, action: 'approve' | 'deny') => {
      setIsSubmitting(true)
      try {
        await onRespond(input)
      } catch (error) {
        logger.error('Failed to send permission response', error as Error, {
          action,
          approvalId: request.approvalId
        })
        toast.error(t('agent.toolPermission.error.sendFailed'))
        setIsSubmitting(false)
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
    <NarrowLayout
      data-composer-viewport-inset-target=""
      narrowMode={forceNarrowLayout || narrowMode}
      withSidePadding
      style={{ width: '100%' }}
      className={cn('relative z-2 pb-3', className)}>
      <div className="rounded-[20px] border-[0.5px] border-border bg-card p-2 shadow-sm">
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-1 flex min-w-0 items-center gap-1.5 font-medium text-[13px] text-foreground leading-5">
              <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{t('agent.toolPermission.confirmation')}</span>
            </h2>
            {subtitle ? (
              <div className="mt-0.5 line-clamp-1 text-muted-foreground text-xs leading-4">{subtitle}</div>
            ) : null}
          </div>
          <div className="rounded-full bg-warning/10 px-1.5 py-0.5 font-medium text-[11px] text-warning">
            {t('agent.toolPermission.pending')}
          </div>
        </div>

        <div className="mt-1.5 overflow-hidden rounded-lg bg-muted dark:bg-muted/30" data-testid="permission-preview">
          <PermissionPreview toolResponse={request.toolResponse} />
        </div>

        <div className="mt-2 flex items-center justify-end gap-1.5 border-border-subtle border-t pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive shadow-none hover:text-destructive"
            disabled={isSubmitting}
            onClick={() => void deny()}>
            {t('agent.toolPermission.button.deny')}
          </Button>
          <Button type="button" size="sm" disabled={isSubmitting} onClick={() => void approve()}>
            {t('agent.toolPermission.button.allow')}
          </Button>
        </div>
      </div>
    </NarrowLayout>
  )
}
