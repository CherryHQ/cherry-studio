import { Badge, Button, EmptyState } from '@cherrystudio/ui'
import type { VirtualItem } from '@tanstack/react-virtual'
import { MoreHorizontal } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { RESOURCE_TYPE_META } from '../constants'
import type { ResourceItem } from '../types'
import { type AssistantCatalogPreset, getAssistantPresetCatalogKey } from './useAssistantPresetCatalog'

function getPresetSummary(preset: AssistantCatalogPreset) {
  return (preset.description || preset.prompt || '').replace(/\s+/g, ' ').trim()
}

interface AssistantCatalogPresetContentProps {
  presets: AssistantCatalogPreset[]
  search: string
  addingPresetKeys: ReadonlySet<string>
  onAddPreset: (preset: AssistantCatalogPreset) => void
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
  onAddPreset,
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
              className="grid gap-3"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
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
                    onAdd={onAddPreset}
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
            onAdd={onAddPreset}
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
  onAdd: (preset: AssistantCatalogPreset) => void
  onPreview: (preset: AssistantCatalogPreset) => void
}

function AssistantPresetGridCard({ preset, adding, onAdd, onPreview }: AssistantPresetCardProps) {
  const { t } = useTranslation()
  const summary = getPresetSummary(preset)
  const groups = (preset.group || []).slice(0, 3)

  return (
    <div
      className="group flex min-h-[178px] flex-col rounded-lg border border-border/40 bg-card p-4 hover:border-border/60 hover:shadow-black/[0.035] hover:shadow-lg"
      onClick={() => onPreview(preset)}>
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xs bg-accent/55 text-base">
          {preset.emoji || '🤖'}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-foreground text-sm">{preset.name}</h4>
          <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1">
            {groups.map((group) => (
              <Badge
                key={group}
                variant="secondary"
                className="border-0 bg-accent/60 px-1.5 py-px text-muted-foreground/65 text-xs">
                {group}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      <p className="line-clamp-3 min-h-[4.5em] flex-1 text-muted-foreground/70 text-xs leading-relaxed">{summary}</p>
      <div className="mt-4 flex items-center justify-end gap-1.5">
        <Button
          variant="default"
          disabled={adding}
          onClick={(e) => {
            e.stopPropagation()
            onAdd(preset)
          }}
          className="flex h-7 min-h-0 items-center gap-1 rounded-lg px-2.5 font-normal text-xs shadow-none transition-colors focus-visible:ring-0">
          {t('library.assistant_catalog.add')}
        </Button>
      </div>
    </div>
  )
}

interface ResourceCardProps {
  resource: ResourceItem
  onEdit: (resource: ResourceItem) => void
  onOpenMenu: (id: string, event: MouseEvent) => void
}

export function ResourceCard({ resource: r, onEdit, onOpenMenu }: ResourceCardProps) {
  const cfg = RESOURCE_TYPE_META[r.type]
  // Skills get the type-specific tinted background to match the menu icon;
  // assistants / agents fall back to the neutral accent block.
  const useTypedAvatarBg = r.type === 'skill'

  return (
    <div
      className="group relative cursor-pointer rounded-lg border border-border/40 bg-card hover:border-border/60 hover:shadow-black/[0.04] hover:shadow-lg"
      onClick={() => onEdit(r)}>
      <div className="p-4">
        <div className="mb-3 flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xs text-base ${
              useTypedAvatarBg ? cfg.color : 'bg-accent/50'
            }`}>
            {r.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-foreground text-sm">{r.name}</h4>
            </div>
            {r.model && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-muted-foreground/50 text-xs">{r.model}</span>
              </div>
            )}
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => onOpenMenu(r.id, e)}
              className="flex h-6 min-h-0 w-6 items-center justify-center rounded-3xs p-0 font-normal text-muted-foreground/40 opacity-0 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 group-hover:opacity-100">
              <MoreHorizontal size={12} />
            </Button>
          </div>
        </div>
        <p className="mb-3 line-clamp-2 min-h-[2lh] text-muted-foreground/70 text-xs leading-relaxed">
          {r.description}
        </p>
        <div className="flex min-h-5 items-center justify-end">
          <div className="flex items-center gap-1.5">
            {r.tags.slice(0, 2).map((tag, i) => (
              <Badge
                key={`${tag}-${i}`}
                variant="secondary"
                className="border-0 bg-accent/50 px-1.5 py-px text-muted-foreground/60 text-xs">
                {tag}
              </Badge>
            ))}
            {r.tags.length > 2 && <span className="text-muted-foreground/50 text-xs">+{r.tags.length - 2}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
