import { Button, NormalTooltip, Tooltip } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import OpenExternalAppButton from '@renderer/components/chat/panes/OpenExternalAppButton'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { type ResourceEditDialogTarget } from '@renderer/components/resourceCatalog/dialogs/edit'
import { AgentSelector, WorkspaceSelector } from '@renderer/components/resourceCatalog/selectors'
import { cn } from '@renderer/utils/style'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { Bot, ChevronDown, CircleSlash, Folder, Sparkles, TriangleAlert, X } from 'lucide-react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  COMPOSER_BELOW_SELECTOR_BUTTON_CLASS,
  COMPOSER_ICON_ONLY_LABEL_CLASS,
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
  COMPOSER_SELECTOR_BUTTON_CLASS
} from '../shared/ComposerControlScaffolding'
import { AgentLabel } from './AgentLabel'

const ResourceEditDialogHost = React.lazy(() =>
  import('@renderer/components/resourceCatalog/dialogs/edit').then((module) => ({
    default: module.ResourceEditDialogHost
  }))
)

export type AgentConversationWorkspace = Pick<AgentWorkspaceEntity, 'type'> &
  Partial<Pick<AgentWorkspaceEntity, 'id' | 'name' | 'path'>>

export interface AgentConversationControlsProps {
  agent?: AgentEntity
  model?: Model
  workspace?: AgentConversationWorkspace | null
  workspaceId?: string | null
  workspaceChanging?: boolean
  workspaceWarning?: string
  selectAgentLabel: string
  selectModelLabel: string
  selectWorkspaceLabel: string
  agentChanging?: boolean
  shouldAutoSelectCreatedAgent: boolean
  side: 'top' | 'bottom'
  iconOnly?: boolean
  agentTriggerMode: 'selector' | 'edit'
  canChangeModel: boolean
  onAgentChange: (agentId: string | null) => void | Promise<void>
  onModelSelect: (model: Model | undefined) => void
  onWorkspaceChange?: (workspaceId: string | null) => void | Promise<void>
  modelFilter?: (model: Model) => boolean
  onAgentDialogCloseAutoFocus?: () => void
}

function AgentControl({
  agent,
  selectAgentLabel,
  agentChanging,
  shouldAutoSelectCreatedAgent,
  side,
  iconOnly = false,
  agentTriggerMode,
  onAgentDialogCloseAutoFocus,
  onAgentChange
}: Pick<
  AgentConversationControlsProps,
  | 'agent'
  | 'selectAgentLabel'
  | 'agentChanging'
  | 'shouldAutoSelectCreatedAgent'
  | 'side'
  | 'iconOnly'
  | 'agentTriggerMode'
  | 'onAgentDialogCloseAutoFocus'
  | 'onAgentChange'
>) {
  const baseTriggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const triggerClassName = cn(baseTriggerClassName, iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const labelClassName = cn('truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const chevronClassName = cn('text-muted-foreground', iconOnly && 'hidden')
  const [agentEditDialogTarget, setAgentEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)

  const agentTrigger = (
    <Button
      variant="ghost"
      size="sm"
      className={triggerClassName}
      disabled={agentChanging || (agentTriggerMode === 'edit' && !agent)}
      onClick={
        agentTriggerMode === 'edit' && agent
          ? () => setAgentEditDialogTarget({ kind: 'agent', id: agent.id })
          : undefined
      }>
      {agent ? (
        <AgentLabel
          agent={agent}
          avatarSize={20}
          classNames={{
            name: cn('max-w-40 text-xs', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS),
            container: 'gap-1.5'
          }}
        />
      ) : (
        <>
          {iconOnly ? <Bot size={20} aria-hidden /> : null}
          <span className={cn('max-w-40 text-muted-foreground', labelClassName)}>{selectAgentLabel}</span>
        </>
      )}
      {agentTriggerMode === 'selector' ? <ChevronDown size={14} className={chevronClassName} /> : null}
    </Button>
  )

  if (agentTriggerMode === 'edit') {
    return (
      <>
        {agentTrigger}
        {agentEditDialogTarget ? (
          <React.Suspense fallback={null}>
            <ResourceEditDialogHost
              target={agentEditDialogTarget}
              onOpenChange={(open) => {
                if (!open) {
                  setAgentEditDialogTarget(null)
                  onAgentDialogCloseAutoFocus?.()
                }
              }}
            />
          </React.Suspense>
        ) : null}
      </>
    )
  }

  return (
    <AgentSelector
      value={agent?.id ?? null}
      onChange={onAgentChange}
      autoSelectOnCreate={shouldAutoSelectCreatedAgent}
      side={side}
      align="start"
      mountStrategy="lazy-keep"
      onDialogCloseAutoFocus={onAgentDialogCloseAutoFocus}
      trigger={agentTrigger}
    />
  )
}

function ModelControl({
  model,
  selectModelLabel,
  canChangeModel,
  side,
  iconOnly = false,
  onModelSelect,
  modelFilter
}: Pick<
  AgentConversationControlsProps,
  'model' | 'selectModelLabel' | 'canChangeModel' | 'side' | 'iconOnly' | 'onModelSelect' | 'modelFilter'
>) {
  const baseTriggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const triggerClassName = cn(baseTriggerClassName, iconOnly && model && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS)
  const labelClassName = cn('truncate', iconOnly && model && COMPOSER_ICON_ONLY_LABEL_CLASS)
  const modelLabel = model ? model.name : selectModelLabel
  const trigger = (
    <Button variant="ghost" size="sm" className={triggerClassName} disabled={!canChangeModel}>
      {model ? (
        <ModelAvatar model={model} size={20} className="shrink-0" />
      ) : (
        <Sparkles size={20} aria-hidden className="text-muted-foreground" />
      )}
      <span
        className={cn(
          'max-w-40 text-xs',
          canChangeModel ? (model ? 'text-foreground' : 'text-muted-foreground') : undefined,
          labelClassName
        )}>
        {modelLabel}
      </span>
      <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && model && 'hidden')} />
    </Button>
  )

  return (
    <ModelSelector
      multiple={false}
      value={model}
      onSelect={onModelSelect}
      filter={modelFilter}
      shortcut={canChangeModel ? 'chat.model.select' : undefined}
      side={side}
      align="start"
      mountStrategy="lazy-keep"
      trigger={trigger}
    />
  )
}

function WorkspaceControl({
  workspace,
  workspaceId,
  workspaceChanging,
  workspaceWarning,
  selectWorkspaceLabel,
  side,
  iconOnly = false,
  onWorkspaceChange
}: Pick<
  AgentConversationControlsProps,
  | 'workspace'
  | 'workspaceId'
  | 'workspaceChanging'
  | 'workspaceWarning'
  | 'selectWorkspaceLabel'
  | 'side'
  | 'iconOnly'
  | 'onWorkspaceChange'
>) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const baseTriggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const hasWarning = Boolean(workspaceWarning)
  const isSystemWorkspace = workspace?.type === 'system'
  const selectorValue = isSystemWorkspace ? null : workspaceId
  const workspaceLabel = isSystemWorkspace
    ? t('agent.session.workspace_selector.no_project')
    : (workspace?.name ?? selectWorkspaceLabel)
  const canQuickClearWorkspace = Boolean(onWorkspaceChange && workspace && !iconOnly)
  if (!onWorkspaceChange && workspace?.type === 'user' && workspace.path) {
    const openMenuTrigger = (
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className={cn(
          baseTriggerClassName,
          'relative',
          iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
          hasWarning && 'text-warning hover:text-warning'
        )}
        aria-label={workspaceWarning}>
        {hasWarning ? (
          <TriangleAlert size={20} aria-hidden />
        ) : (
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            <Folder size={20} aria-hidden className="shrink-0 text-muted-foreground" />
          </span>
        )}
        <span className={cn('max-w-40 truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)}>{workspaceLabel}</span>
        <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && 'hidden')} />
      </Button>
    )
    return <OpenExternalAppButton workdir={workspace.path} menuTrigger={openMenuTrigger} tooltip={workspaceWarning} />
  }

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      className={cn(
        baseTriggerClassName,
        !menuOpen && 'group',
        'relative',
        iconOnly && COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS,
        hasWarning && 'text-warning hover:text-warning'
      )}
      disabled={!onWorkspaceChange || workspaceChanging}
      aria-label={workspaceWarning}
      onClick={(event) => {
        const target = event.target as Element | null
        if (!canQuickClearWorkspace || !target?.closest('[data-clear-workspace-button]')) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        if (!workspaceChanging) void onWorkspaceChange?.(null)
      }}>
      {hasWarning ? (
        <TriangleAlert size={20} aria-hidden />
      ) : isSystemWorkspace ? (
        <CircleSlash size={20} aria-hidden className="text-muted-foreground" />
      ) : (
        <span className="relative flex size-5 shrink-0 items-center justify-center">
          <Folder
            size={20}
            aria-hidden
            className={cn(
              'shrink-0 text-muted-foreground transition-all duration-200',
              canQuickClearWorkspace && !menuOpen && 'group-hover:scale-75 group-hover:opacity-0'
            )}
          />
          {canQuickClearWorkspace && (
            <NormalTooltip content={t('agent.session.workspace_selector.no_project')} side="top">
              <span
                data-clear-workspace-button
                data-testid="clear-workspace-button"
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-0 z-10 flex scale-75 items-center justify-center rounded-full bg-transparent text-muted-foreground opacity-0 transition-all duration-200 hover:bg-muted-foreground/25 hover:text-foreground active:scale-95',
                  !menuOpen && 'group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100',
                  workspaceChanging && 'cursor-not-allowed opacity-50'
                )}
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={(event) => event.preventDefault()}>
                <X size={10} className="stroke-[2.5]" />
              </span>
            </NormalTooltip>
          )}
        </span>
      )}
      <span className={cn('max-w-40 truncate', iconOnly && COMPOSER_ICON_ONLY_LABEL_CLASS)}>{workspaceLabel}</span>
      {onWorkspaceChange ? (
        <ChevronDown size={14} aria-hidden className={cn('text-muted-foreground', iconOnly && 'hidden')} />
      ) : null}
    </Button>
  )

  const selector = onWorkspaceChange ? (
    <WorkspaceSelector
      value={selectorValue}
      onChange={onWorkspaceChange}
      shouldClearSelectionOnDelete={false}
      side={side}
      align="start"
      mountStrategy="lazy-keep"
      disabled={workspaceChanging}
      trigger={trigger}
      open={menuOpen}
      onOpenChange={setMenuOpen}
    />
  ) : (
    trigger
  )

  if (!hasWarning) return selector
  return <Tooltip content={workspaceWarning}>{selector}</Tooltip>
}

export function AgentConversationControls(props: AgentConversationControlsProps) {
  return (
    <>
      <AgentControl {...props} />
      <ModelControl {...props} />
      <WorkspaceControl {...props} />
    </>
  )
}
