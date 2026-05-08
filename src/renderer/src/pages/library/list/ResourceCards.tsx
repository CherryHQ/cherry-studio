import { Badge, Button, EmptyState } from '@cherrystudio/ui'
import { MoreHorizontal } from 'lucide-react'
import { motion } from 'motion/react'
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
}

export function AssistantCatalogPresetContent({
  presets,
  search,
  addingPresetKeys,
  onAddPreset,
  onPreviewPreset
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

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {presets.map((preset, index) => {
        const presetKey = getAssistantPresetCatalogKey(preset)
        return (
          <AssistantPresetGridCard
            key={`${presetKey}-${index}`}
            preset={preset}
            index={index}
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
  index: number
  adding: boolean
  onAdd: (preset: AssistantCatalogPreset) => void
  onPreview: (preset: AssistantCatalogPreset) => void
}

function AssistantPresetGridCard({ preset, index, adding, onAdd, onPreview }: AssistantPresetCardProps) {
  const { t } = useTranslation()
  const summary = getPresetSummary(preset)
  const groups = (preset.group || []).slice(0, 3)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.02 }}
      className="group flex min-h-[178px] flex-col rounded-lg border border-border/40 bg-card p-4 transition-all duration-200 hover:border-border/60 hover:shadow-black/[0.035] hover:shadow-lg"
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
    </motion.div>
  )
}

interface ResourceCardProps {
  resource: ResourceItem
  index: number
  onEdit: (resource: ResourceItem) => void
  onOpenMenu: (id: string, event: MouseEvent) => void
}

export function ResourceCard({ resource: r, index, onEdit, onOpenMenu }: ResourceCardProps) {
  const cfg = RESOURCE_TYPE_META[r.type]
  // Skills get the type-specific tinted background to match the menu icon;
  // assistants / agents fall back to the neutral accent block.
  const useTypedAvatarBg = r.type === 'skill'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.02 }}
      whileHover={{ y: -2 }}
      className="group relative cursor-pointer rounded-lg border border-border/40 bg-card transition-all duration-200 hover:border-border/60 hover:shadow-black/[0.04] hover:shadow-lg"
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
    </motion.div>
  )
}
