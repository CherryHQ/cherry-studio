import { Play, Trash2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Switch, Tooltip } from '@cherrystudio/ui'
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
  columnCount?: number
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
    <Switch
      size="sm"
      checked={resource.raw.isGlobalEnabled}
      disabled={isUpdating}
      aria-label={t('settings.skills.globalToggle', { name: resource.name })}
      onCheckedChange={handleCheckedChange}
    />
  )
}

export function ResourceCard({
  resource: r,
  variant = 'library',
  columnCount = 1,
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
  const isSkillGrid = isSettings && r.type === 'skill' && columnCount === 2
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
          : 'rounded-lg border-border-subtle hover:border-border-subtle'
      )}
      style={r.type === 'skill' ? { backgroundColor: 'var(--settings-group-background, var(--card))' } : undefined}
      role="button"
      tabIndex={0}
      aria-label={r.name}
      onClick={() => onEdit(r)}
      onKeyDown={(e) => activateCardOnKeyDown(e, () => onEdit(r))}>
      <div className={isSkillGrid ? 'px-4 py-2' : isSettings ? 'p-4' : 'p-3.5'}>
        <div
          className={isSkillGrid ? 'grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-1' : 'flex items-center gap-3'}>
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg text-base',
              isSkillGrid && 'row-span-2 self-center',
              showTypeIcon ? cfg.color : 'bg-secondary text-secondary-foreground'
            )}>
            {showTypeIcon ? <TypeIcon size={20} aria-hidden className="lucide-custom" /> : r.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Tooltip title={r.name} isDisabled={!isSkillGrid} asChild>
                <h4
                  className="min-w-0 truncate text-sm leading-5 font-medium text-foreground"
                  tabIndex={isSkillGrid ? 0 : undefined}>
                  {r.name}
                </h4>
              </Tooltip>
              {skillVersion && (
                <Badge
                  variant="secondary"
                  className="text-muted-foreground shrink-0 border-0 bg-secondary px-1.5 py-px text-xs font-normal">
                  {skillVersion}
                </Badge>
              )}
              {r.type === 'skill' ? <SkillSourceBadge source={r.raw.source} sourceUrl={r.raw.sourceUrl} /> : null}
            </div>
            <Tooltip title={r.description} isDisabled={!isSkillGrid} asChild>
              <p
                className={cn(
                  'text-muted-foreground mt-0.5 text-xs leading-4',
                  isSkillGrid ? 'min-h-4 truncate' : isSettings ? 'line-clamp-2 min-h-8' : 'truncate'
                )}
                tabIndex={isSkillGrid ? 0 : undefined}>
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
          <div className={cn('shrink-0', isSkillGrid && 'col-start-2')} onClick={(e) => e.stopPropagation()}>
            {r.type === 'skill' && isSettings ? (
              <div className={cn('flex items-center gap-1', isSkillGrid && 'justify-end')}>
                {onLaunchSkill ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onLaunchSkill(r)}
                    className={cn('gap-1.5', isSkillGrid && 'mr-auto -ml-2.5 pl-1.5')}>
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
