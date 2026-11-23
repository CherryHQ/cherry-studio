import { Play, Trash2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Switch, Tooltip } from '@cherrystudio/ui'
import { AssistantAvatarImage } from '@renderer/components/Avatar/AssistantAvatarImage'
import { useSkillMutationsById } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { RESOURCE_TYPE_META } from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import type { Group } from '@shared/data/types/group'

import { ResourceCardMenu } from './ResourceCardMenu'
import { SkillSourceBadge } from './SkillSourceBadge'

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
  onLaunchSkill?: (resource: ResourceItem) => void
}

function hasOverflowActions(resource: ResourceItem) {
  return resource.type === 'assistant' || resource.type === 'agent' || resource.type === 'skill'
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
    <Tooltip title={t('settings.skills.globalEnabled')} asChild>
      <span className="inline-flex shrink-0">
        <Switch
          size="sm"
          checked={resource.raw.isGlobalEnabled}
          disabled={isUpdating}
          aria-label={t('settings.skills.globalToggle', { name: resource.name })}
          onCheckedChange={handleCheckedChange}
        />
      </span>
    </Tooltip>
  )
}

export function ResourceCard({
  resource: r,
  variant = 'library',
  allGroups,
  onDelete,
  onDuplicate,
  onEdit,
  onExport,
  onLaunchSkill
}: ResourceCardProps) {
  const { t } = useTranslation()
  const cfg = RESOURCE_TYPE_META[r.type]
  const isSettings = variant === 'settings'
  const isSkillSettings = isSettings && r.type === 'skill'
  const showTypeIcon = r.type === 'skill'
  const TypeIcon = cfg.icon
  const showOverflowMenu = hasOverflowActions(r)
  const visibleGroup = r.type === 'assistant' ? r.groupName : undefined
  const skillVersion = r.type === 'skill' ? r.raw.version?.trim() : undefined

  return (
    <div
      className={cn(
        'group relative cursor-pointer border bg-card transition-[border-color,box-shadow] hover:shadow-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        isSettings
          ? 'hover:border-border-strong rounded-xl border-border'
          : 'rounded-lg border-border-subtle hover:border-border-subtle',
        isSkillSettings &&
          'shadow-none transition-colors hover:bg-background-subtle hover:shadow-none focus-visible:bg-accent focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]',
        isSkillSettings && 'rounded-none border-0 bg-transparent'
      )}
      style={
        r.type === 'skill' && !isSkillSettings
          ? { backgroundColor: 'var(--settings-group-background, var(--card))' }
          : undefined
      }
      role="button"
      tabIndex={0}
      aria-label={r.name}
      onClick={() => onEdit(r)}
      onKeyDown={(e) => activateCardOnKeyDown(e, () => onEdit(r))}>
      <div className={isSkillSettings ? 'px-4 py-4' : isSettings ? 'p-4' : 'p-3.5'}>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg text-base',
              isSkillSettings
                ? 'size-8 bg-secondary text-muted-foreground'
                : showTypeIcon
                  ? cfg.color
                  : 'bg-secondary text-secondary-foreground'
            )}>
            {showTypeIcon ? (
              <TypeIcon size={isSkillSettings ? 18 : 20} aria-hidden className="lucide-custom" />
            ) : (
              <AssistantAvatarImage
                src={r.avatarSrc}
                alt={r.name}
                className="size-10 rounded-lg object-cover"
                fallback={r.avatar}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h4 className="min-w-0 truncate text-sm leading-5 font-medium text-foreground">{r.name}</h4>
              {skillVersion && (
                <Badge
                  variant="secondary"
                  className={cn(
                    'text-muted-foreground shrink-0 border-0 bg-secondary px-1.5 py-px text-xs font-normal',
                    isSkillSettings && 'bg-transparent px-0'
                  )}>
                  {skillVersion}
                </Badge>
              )}
              {r.type === 'skill' ? (
                <SkillSourceBadge
                  source={r.raw.source}
                  sourceUrl={r.raw.sourceUrl}
                  className={isSkillSettings ? 'border border-border bg-transparent text-muted-foreground' : undefined}
                />
              ) : null}
            </div>
            <Tooltip title={r.description} delay={1000} isDisabled={!isSkillSettings} asChild>
              <p
                className={cn(
                  'text-muted-foreground mt-0.5 text-xs leading-4',
                  isSkillSettings ? 'min-h-4 truncate' : isSettings ? 'line-clamp-2 min-h-8' : 'truncate'
                )}
                tabIndex={isSkillSettings ? 0 : undefined}>
                {r.description}
              </p>
            </Tooltip>
            {visibleGroup && (
              <div className="mt-1.5 flex min-w-0 items-center gap-1">
                <Badge
                  variant="secondary"
                  className="text-muted-foreground max-w-24 truncate border-0 bg-secondary px-1.5 py-px text-xs">
                  {visibleGroup}
                </Badge>
              </div>
            )}
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {r.type === 'skill' && isSettings ? (
              <div className="flex items-center gap-3">
                {onLaunchSkill ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onLaunchSkill(r)}
                    className="gap-1.5 text-muted-foreground">
                    <Play size={12} aria-hidden />
                    {t('settings.skills.tryNow')}
                  </Button>
                ) : null}
                <SkillGlobalToggle resource={r} />
                <ResourceCardMenu
                  resource={r}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                  onExport={onExport}
                  allGroups={allGroups}
                  triggerClassName="text-muted-foreground hover:text-foreground"
                />
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
                aria-label={t('common.delete')}
                onClick={() => onDelete(r)}
                className="text-muted-foreground hover:bg-error-subtle hover:text-error-subtle-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                <Trash2 size={12} className="lucide-custom" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
