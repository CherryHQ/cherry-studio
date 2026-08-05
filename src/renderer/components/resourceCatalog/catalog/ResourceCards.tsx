import { Trash2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button } from '@cherrystudio/ui'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { RESOURCE_TYPE_META } from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import type { Group } from '@shared/data/types/group'

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
  // Library cards keep the type tint for quick scanning. The settings surface uses a neutral icon block
  // so Skill management follows the same calm visual hierarchy as the surrounding settings pages.
  const showTypeIcon = r.type === 'skill'
  const useTypedAvatarBg = showTypeIcon && !isSettings
  const TypeIcon = cfg.icon
  const showOverflowMenu = hasOverflowActions(r)
  const visibleGroup = r.type === 'assistant' ? r.groupName : undefined
  const skillVersion = r.type === 'skill' ? r.raw.version?.trim() : undefined

  return (
    <div
      className={cn(
        'group relative cursor-pointer border bg-card transition-[border-color,box-shadow] hover:shadow-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
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
              useTypedAvatarBg ? cfg.color : 'bg-secondary text-secondary-foreground'
            )}>
            {showTypeIcon ? (
              <TypeIcon size={20} aria-hidden className={isSettings ? 'text-foreground-tertiary' : undefined} />
            ) : (
              r.avatar
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h4 className="min-w-0 truncate text-sm leading-5 font-medium text-foreground">{r.name}</h4>
              {skillVersion && (
                <Badge
                  variant="secondary"
                  className="shrink-0 border-0 bg-secondary px-1.5 py-px text-xs font-normal text-muted-foreground">
                  {skillVersion}
                </Badge>
              )}
            </div>
            <p
              className={cn(
                'mt-0.5 text-xs leading-4 text-muted-foreground',
                isSettings ? 'line-clamp-2 min-h-8' : 'truncate'
              )}>
              {r.description}
            </p>
            {visibleGroup && (
              <div className="mt-1.5 flex min-w-0 items-center gap-1">
                <Badge
                  variant="secondary"
                  className="max-w-24 truncate border-0 bg-secondary px-1.5 py-px text-xs text-muted-foreground">
                  {visibleGroup}
                </Badge>
              </div>
            )}
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {showOverflowMenu ? (
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
                className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-error-subtle hover:text-error-subtle-foreground focus-visible:opacity-100">
                <Trash2 size={12} className="lucide-custom" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
