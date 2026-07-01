import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { RESOURCE_TYPE_META } from '@renderer/components/resource/resourceCatalogConstants'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
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
  allTagNames: string[]
  onDelete: (resource: ResourceItem) => void
  onDuplicate: (resource: ResourceItem) => void
  onEdit: (resource: ResourceItem) => void
  onExport: (resource: ResourceItem) => void
  onUpdateResourceTags: (resourceId: string, tags: string[]) => void
}

function hasOverflowActions(resource: ResourceItem) {
  return resource.type === 'assistant'
}

export function ResourceCard({
  resource: r,
  allTagNames,
  onDelete,
  onDuplicate,
  onEdit,
  onExport,
  onUpdateResourceTags
}: ResourceCardProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const cfg = RESOURCE_TYPE_META[r.type]
  // Skills get the type-specific tinted background to match the menu icon;
  // other resources keep their own avatar on the neutral accent block.
  const useTypedAvatarBg = r.type === 'skill'
  const showOverflowMenu = hasOverflowActions(r)
  const visibleTags = r.type === 'assistant' ? r.tags.slice(0, 2) : []
  const extraTagCount = r.type === 'assistant' ? r.tags.length - visibleTags.length : 0

  return (
    <div
      className="group relative cursor-pointer rounded-lg border border-border-subtle bg-card transition-[border-color,box-shadow] hover:border-border-muted hover:shadow-sm"
      role="button"
      tabIndex={0}
      aria-label={r.name}
      onClick={() => onEdit(r)}
      onKeyDown={(e) => activateCardOnKeyDown(e, () => onEdit(r))}>
      <div className="p-3.5">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base ${
              useTypedAvatarBg ? cfg.color : 'bg-secondary'
            }`}>
            {r.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="truncate font-medium text-foreground text-sm leading-5">{r.name}</h4>
            <p className="mt-0.5 truncate text-foreground-secondary text-xs leading-4">{r.description}</p>
            {visibleTags.length > 0 && (
              <div className="mt-1.5 flex min-w-0 items-center gap-1">
                {visibleTags.map((tag, i) => (
                  <Badge
                    key={`${tag}-${i}`}
                    variant="secondary"
                    className="max-w-24 truncate border-0 bg-secondary px-1.5 py-px text-foreground-secondary text-xs">
                    {tag}
                  </Badge>
                ))}
                {extraTagCount > 0 && <span className="shrink-0 text-foreground-muted text-xs">+{extraTagCount}</span>}
              </div>
            )}
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {showOverflowMenu ? (
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.more')}
                    onClick={(e) => e.stopPropagation()}
                    className="text-foreground-muted opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
                    <MoreHorizontal size={12} />
                  </Button>
                </PopoverTrigger>
                {menuOpen && (
                  <PopoverContent
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    className="w-40 rounded-lg border-border p-1"
                    onClick={(e) => e.stopPropagation()}>
                    <ResourceCardMenu
                      resource={r}
                      onClose={() => setMenuOpen(false)}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
                      onExport={onExport}
                      onUpdateResourceTags={onUpdateResourceTags}
                      allTagNames={allTagNames}
                    />
                  </PopoverContent>
                )}
              </Popover>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={r.type === 'skill' ? t('library.action.uninstall') : t('common.delete')}
                onClick={() => onDelete(r)}
                className="text-foreground-muted opacity-0 hover:bg-error-bg hover:text-error-text focus-visible:opacity-100 group-hover:opacity-100">
                <Trash2 size={12} className="lucide-custom" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
