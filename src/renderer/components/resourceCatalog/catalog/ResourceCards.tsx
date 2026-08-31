import { Badge, Button, Switch } from '@cherrystudio/ui'
import { useBuiltinAgentListVisibility } from '@renderer/hooks/agent/useBuiltinAgentListVisibility'
import { useSkillMutationsById } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { RESOURCE_TYPE_META } from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { Group } from '@shared/data/types/group'
import { EyeOff, ListPlus, Trash2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceCardMenu } from './ResourceCardMenu'

// Cards expose their primary action on the outer element, so keyboard users need
// Enter/Space to mirror the pointer click. Guard on the event target: a key press on
// a nested action button (More / Delete / Add / Go-to-chat) bubbles up to the card,
// and without this it would also fire the card's primary action.
function activateCardOnKeyDown(event: KeyboardEvent<HTMLDivElement>, activate: () => void) {
  if (event.target !== event.currentTarget) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    activate()
  }
}

interface ResourceCardProps {
  resource: ResourceItem
  variant?: 'library' | 'settings'
  allGroups: Group[]
  onDelete: (resource: ResourceItem) => void
  onDuplicate: (resource: ResourceItem) => void
  onEdit: (resource: ResourceItem) => void
  onExport: (resource: ResourceItem) => void
}

function hasOverflowActions(resource: ResourceItem) {
  return resource.type === 'assistant'
}

function SkillGlobalToggle({ resource }: { resource: Extract<ResourceItem, { type: 'skill' }> }) {
  const { t } = useTranslation()
  const { updateGlobalEnabled, isUpdating } = useSkillMutationsById(resource.id)

  const handleCheckedChange = async (checked: boolean) => {
    try {
      await updateGlobalEnabled(checked)
    } catch {
      toast.error(t('settings.skills.toggleFailed', { name: resource.name }))
    }
  }

  return (
    <Switch
      size="sm"
      checked={resource.raw.isGlobalEnabled}
      disabled={isUpdating}
      aria-label={t('settings.skills.globalToggle', { name: resource.name })}
      onCheckedChange={handleCheckedChange}
    />
  )
}

function ProtectedBuiltinAgentListAction({ resource }: { resource: Extract<ResourceItem, { type: 'agent' }> }) {
  const { t } = useTranslation()
  const { hiddenBuiltinAgentIds, hideBuiltinAgent, showBuiltinAgent } = useBuiltinAgentListVisibility()
  const hidden = hiddenBuiltinAgentIds.includes(resource.id)
  const label = t(hidden ? 'agent.session.agent.add_to_list' : 'agent.session.agent.hide_from_list')
  const Icon = hidden ? ListPlus : EyeOff

  const handleClick = () => void (hidden ? showBuiltinAgent(resource.id) : hideBuiltinAgent(resource.id))

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={handleClick}
      className="text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100">
      <Icon size={12} className="lucide-custom" />
      <span>{label}</span>
    </Button>
  )
}

export function ResourceCard({
  resource: r,
  variant = 'library',
  allGroups,
  onDelete,
  onDuplicate,
  onEdit,
  onExport
}: ResourceCardProps) {
  const { t } = useTranslation()
  const cfg = RESOURCE_TYPE_META[r.type]
  const isSettings = variant === 'settings'
  const showTypeIcon = r.type === 'skill'
  const TypeIcon = cfg.icon
  const showOverflowMenu = hasOverflowActions(r)
  const protectedBuiltinAgent =
    r.type === 'agent' && isProtectedBuiltinAgentRole(r.raw.configuration?.builtin_role) ? r : null
  const visibleGroup = r.type === 'assistant' ? r.groupName : undefined
  const skillVersion = r.type === 'skill' ? r.raw.version?.trim() : undefined

  return (
    <div
      className={cn(
        'group relative cursor-pointer border bg-card transition-[border-color,box-shadow] hover:shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        isSettings
          ? 'rounded-xl border-border hover:border-border-strong'
          : 'rounded-lg border-border-subtle hover:border-border-subtle'
      )}
      style={r.type === 'skill' ? { backgroundColor: 'var(--settings-group-background, var(--card))' } : undefined}
      role="button"
      tabIndex={0}
      aria-label={r.name}
      onClick={() => onEdit(r)}
      onKeyDown={(e) => activateCardOnKeyDown(e, () => onEdit(r))}>
      <div className={isSettings ? 'p-4' : 'p-3.5'}>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg text-base',
              showTypeIcon ? cfg.color : 'bg-secondary text-secondary-foreground'
            )}>
            {showTypeIcon ? <TypeIcon size={20} aria-hidden className="lucide-custom" /> : r.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h4 className="min-w-0 truncate font-medium text-foreground text-sm leading-5">{r.name}</h4>
              {skillVersion && (
                <Badge
                  variant="secondary"
                  className="shrink-0 border-0 bg-secondary px-1.5 py-px font-normal text-muted-foreground text-xs">
                  {skillVersion}
                </Badge>
              )}
            </div>
            <p
              className={cn(
                'mt-0.5 text-muted-foreground text-xs leading-4',
                isSettings ? 'line-clamp-2 min-h-8' : 'truncate'
              )}>
              {r.description}
            </p>
            {visibleGroup && (
              <div className="mt-1.5 flex min-w-0 items-center gap-1">
                <Badge
                  variant="secondary"
                  className="max-w-24 truncate border-0 bg-secondary px-1.5 py-px text-muted-foreground text-xs">
                  {visibleGroup}
                </Badge>
              </div>
            )}
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {protectedBuiltinAgent ? (
              <ProtectedBuiltinAgentListAction resource={protectedBuiltinAgent} />
            ) : r.type === 'skill' && isSettings ? (
              <div className="flex items-center gap-1">
                <SkillGlobalToggle resource={r} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('library.action.uninstall')}
                  onClick={() => onDelete(r)}
                  className="text-muted-foreground opacity-0 hover:bg-error-subtle hover:text-error-subtle-foreground focus-visible:opacity-100 group-hover:opacity-100">
                  <Trash2 size={12} className="lucide-custom" />
                </Button>
              </div>
            ) : showOverflowMenu ? (
              <ResourceCardMenu
                resource={r}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onExport={onExport}
                allGroups={allGroups}
                triggerClassName="text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              />
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={r.type === 'skill' ? t('library.action.uninstall') : t('common.delete')}
                onClick={() => onDelete(r)}
                className="text-muted-foreground opacity-0 hover:bg-error-subtle hover:text-error-subtle-foreground focus-visible:opacity-100 group-hover:opacity-100">
                <Trash2 size={12} className="lucide-custom" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
