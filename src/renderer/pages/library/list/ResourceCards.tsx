import { Badge, Button, EmptyState, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import type { VirtualItem } from '@tanstack/react-virtual'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RESOURCE_TYPE_META } from '../constants'
import type { ResourceItem } from '../types'
import { ResourceCardMenu } from './ResourceCardMenu'
import { type AssistantCatalogPreset, getAssistantPresetCatalogKey } from './useAssistantPresetCatalog'

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

function getPresetSummary(preset: AssistantCatalogPreset) {
  return (preset.description || preset.prompt || '').replace(/\s+/g, ' ').trim()
}

interface AssistantCatalogPresetContentProps {
  presets: AssistantCatalogPreset[]
  search: string
  addingPresetKeys: ReadonlySet<string>
  addedAssistantPresets: Readonly<Record<string, string>>
  onAddPreset: (preset: AssistantCatalogPreset) => void
  onOpenPresetChat: (assistantId: string) => void
  onPreviewPreset: (preset: AssistantCatalogPreset) => void
  rows?: AssistantCatalogPreset[][]
  columnCount?: number
  virtualRows?: VirtualItem[]
  totalHeight?: number
  measureRow?: (node: Element | null) => void
}

export function AssistantCatalogPresetContent({
  presets,
  search,
  addingPresetKeys,
  addedAssistantPresets,
  onAddPreset,
  onOpenPresetChat,
  onPreviewPreset,
  rows,
  columnCount,
  virtualRows,
  totalHeight,
  measureRow
}: AssistantCatalogPresetContentProps) {
  const { t } = useTranslation()

  if (presets.length === 0) {
    return (
      <EmptyState
        preset={search ? 'no-result' : 'no-resource'}
        title={search ? t('library.assistant_catalog.no_match_title') : t('library.assistant_catalog.empty_title')}
        description={
          search
            ? t('library.assistant_catalog.no_match_description')
            : t('library.assistant_catalog.empty_description')
        }
        className="py-20"
      />
    )
  }

  if (rows && columnCount && virtualRows && typeof totalHeight === 'number' && measureRow) {
    return (
      <div style={{ height: totalHeight, position: 'relative' }}>
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index] ?? []
          return (
            <div
              key={virtualRow.key}
              ref={measureRow}
              data-index={virtualRow.index}
              className="grid gap-3 pb-3"
              style={{
                position: 'absolute',
                top: 0,
                insetInlineStart: 0,
                width: '100%',
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                transform: `translateY(${virtualRow.start}px)`
              }}>
              {row.map((preset, index) => {
                const presetKey = getAssistantPresetCatalogKey(preset)
                return (
                  <AssistantPresetGridCard
                    key={`${presetKey}-${virtualRow.index}-${index}`}
                    preset={preset}
                    adding={addingPresetKeys.has(presetKey)}
                    addedAssistantId={addedAssistantPresets[presetKey]}
                    onAdd={onAddPreset}
                    onOpenChat={onOpenPresetChat}
                    onPreview={onPreviewPreset}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {presets.map((preset, index) => {
        const presetKey = getAssistantPresetCatalogKey(preset)
        return (
          <AssistantPresetGridCard
            key={`${presetKey}-${index}`}
            preset={preset}
            adding={addingPresetKeys.has(presetKey)}
            addedAssistantId={addedAssistantPresets[presetKey]}
            onAdd={onAddPreset}
            onOpenChat={onOpenPresetChat}
            onPreview={onPreviewPreset}
          />
        )
      })}
    </div>
  )
}

interface AssistantPresetCardProps {
  preset: AssistantCatalogPreset
  adding: boolean
  addedAssistantId?: string
  onAdd: (preset: AssistantCatalogPreset) => void
  onOpenChat: (assistantId: string) => void
  onPreview: (preset: AssistantCatalogPreset) => void
}

function AssistantPresetGridCard({
  preset,
  adding,
  addedAssistantId,
  onAdd,
  onOpenChat,
  onPreview
}: AssistantPresetCardProps) {
  const { t } = useTranslation()
  const summary = getPresetSummary(preset)
  const groups = (preset.group || []).slice(0, 2)
  const extraGroupCount = Math.max((preset.group || []).length - groups.length, 0)
  const actionLabel = addedAssistantId ? t('library.assistant_catalog.go_to_chat') : t('library.assistant_catalog.add')

  return (
    <div
      className="group flex min-h-36 cursor-pointer flex-col rounded-lg border border-border-subtle bg-card p-3.5 transition-[border-color,box-shadow] hover:border-border-muted hover:shadow-sm"
      role="button"
      tabIndex={0}
      aria-label={preset.name}
      onClick={() => onPreview(preset)}
      onKeyDown={(e) => activateCardOnKeyDown(e, () => onPreview(preset))}>
      <div className="mb-2.5 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-base">
          {preset.emoji || '🤖'}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate font-medium text-foreground text-sm leading-5">{preset.name}</h4>
          {groups.length > 0 && (
            <div className="mt-1 flex min-h-5 items-center gap-1 overflow-hidden">
              {groups.map((group) => (
                <Badge
                  key={group}
                  variant="secondary"
                  className="max-w-20 truncate border-0 bg-secondary px-1.5 py-px text-foreground-secondary text-xs">
                  {group}
                </Badge>
              ))}
              {extraGroupCount > 0 && (
                <span className="shrink-0 text-foreground-muted text-xs">+{extraGroupCount}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="line-clamp-2 flex-1 text-foreground-secondary text-xs leading-5">{summary}</p>
      <div className="mt-3 flex items-center justify-end">
        <Button
          variant="default"
          disabled={!addedAssistantId && adding}
          onClick={(e) => {
            e.stopPropagation()
            if (addedAssistantId) {
              onOpenChat(addedAssistantId)
            } else {
              onAdd(preset)
            }
          }}
          size="sm"
          className="shrink-0">
          {actionLabel}
        </Button>
      </div>
    </div>
  )
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
