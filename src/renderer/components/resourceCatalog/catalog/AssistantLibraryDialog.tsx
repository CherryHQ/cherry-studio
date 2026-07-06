import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, Input, Skeleton } from '@cherrystudio/ui'
import { AssistantPresetPreviewDialog } from '@renderer/components/resourceCatalog/dialogs/detail'
import { useAssistantMutations } from '@renderer/hooks/resourceCatalog'
import {
  ASSISTANT_CATALOG_MY_TAB,
  type AssistantCatalogPreset,
  buildAssistantCatalogTabs,
  filterAssistantCatalogPresets,
  getAssistantPresetCatalogKey,
  toCreateAssistantDtoFromCatalogPreset,
  useAssistantCatalogPresets
} from '@renderer/hooks/useAssistantCatalogPresets'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Plus, Search, X } from 'lucide-react'
import { type KeyboardEvent, memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Local "browse everything" tab that sits before the preset categories. It is dialog-only —
// the shared catalog surface has no such concept — so it lives here rather than in the catalog hook.
const LIBRARY_ALL_TAB = '__all__'
const PRESET_ROW_ESTIMATE_PX = 62
const PRESET_ROW_GAP_PX = 8

type AssistantLibraryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a preset is added so the underlying assistant grid can revalidate. */
  onAssistantAdded?: () => void
  /** Open the freshly-added assistant's chat. Optional: the resource-center page has no chat nav. */
  onOpenAssistantChat?: (assistantId: string) => void
}

function getPresetSummary(preset: AssistantCatalogPreset) {
  return (preset.description || preset.prompt || '').replace(/\s+/g, ' ').trim()
}

function matchesSearch(preset: AssistantCatalogPreset, keyword: string) {
  if (!keyword) return true
  return [preset.name, preset.description, preset.prompt]
    .filter(Boolean)
    .some((text) => text?.toLowerCase().includes(keyword))
}

/**
 * The community assistant preset catalog rendered as a self-contained dialog.
 *
 * Reuses the preset source (`useAssistantCatalogPresets`), the category grouping helpers, and the
 * preview dialog, but renders dialog-native chrome — a segmented tab bar (with a leading "全部" tab),
 * a right-aligned compact search, and a single-column list — rather than the legacy library page's
 * grid, so the picker feels calmer than the full management view. Adding a preset mirrors the inline
 * flow exactly (`createAssistant(toCreateAssistantDtoFromCatalogPreset(...))`).
 */
export function AssistantLibraryDialog({
  open,
  onOpenChange,
  onAssistantAdded,
  onOpenAssistantChat
}: AssistantLibraryDialogProps) {
  const { t } = useTranslation()
  const { createAssistant } = useAssistantMutations()
  const { isLoading, presets: rawPresets } = useAssistantCatalogPresets({ enabled: open })
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<string>(LIBRARY_ALL_TAB)
  const [addingPresetKeys, setAddingPresetKeys] = useState<Set<string>>(new Set())
  const [addedAssistantPresets, setAddedAssistantPresets] = useState<Record<string, string>>({})
  const [previewPreset, setPreviewPreset] = useState<AssistantCatalogPreset | null>(null)
  const [previewAdding, setPreviewAdding] = useState(false)
  const listScrollRef = useRef<HTMLDivElement>(null)

  // "全部" first, then the preset categories (drop the catalog's "我的" tab — its list lives on the page).
  const tabs = useMemo(() => {
    const categoryTabs = buildAssistantCatalogTabs(rawPresets, 0, '').filter(
      (tab) => tab.id !== ASSISTANT_CATALOG_MY_TAB
    )
    return [{ id: LIBRARY_ALL_TAB, label: t('common.all'), count: rawPresets.length }, ...categoryTabs]
  }, [rawPresets, t])

  // Repair the active tab if the selected category disappears (e.g. the catalog reloads).
  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTab)) return
    setActiveTab(LIBRARY_ALL_TAB)
  }, [activeTab, tabs])

  // Reset transient browse state when the dialog closes.
  useEffect(() => {
    if (open) return
    setSearch('')
    setActiveTab(LIBRARY_ALL_TAB)
    setAddedAssistantPresets({})
    setPreviewPreset(null)
  }, [open])

  const visiblePresets = useMemo(() => {
    if (activeTab === LIBRARY_ALL_TAB) {
      const keyword = search.trim().toLowerCase()
      return rawPresets.filter((preset) => matchesSearch(preset, keyword))
    }
    return filterAssistantCatalogPresets(rawPresets, activeTab, search)
  }, [activeTab, rawPresets, search])

  const addPreset = useCallback(
    async (preset: AssistantCatalogPreset) => {
      const assistant = await createAssistant(toCreateAssistantDtoFromCatalogPreset(preset))
      setAddedAssistantPresets((current) => ({
        ...current,
        [getAssistantPresetCatalogKey(preset)]: assistant.id
      }))
      onAssistantAdded?.()
      window.toast.success(t('common.add_success'))
      return assistant
    },
    [createAssistant, onAssistantAdded, t]
  )

  const handleAddPreset = useCallback(
    async (preset: AssistantCatalogPreset) => {
      const presetKey = getAssistantPresetCatalogKey(preset)
      if (addingPresetKeys.has(presetKey)) return

      setAddingPresetKeys((prev) => new Set(prev).add(presetKey))
      try {
        await addPreset(preset)
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('library.assistant_catalog.add_failed')))
      } finally {
        setAddingPresetKeys((prev) => {
          const next = new Set(prev)
          next.delete(presetKey)
          return next
        })
      }
    },
    [addPreset, addingPresetKeys, t]
  )

  const handleAddPreviewPreset = useCallback(async () => {
    if (!previewPreset || previewAdding) return

    setPreviewAdding(true)
    try {
      await addPreset(previewPreset)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('library.assistant_catalog.add_failed')))
    } finally {
      setPreviewAdding(false)
    }
  }, [addPreset, previewAdding, previewPreset, t])

  const handleOpenChat = useCallback(
    (assistantId: string) => {
      if (!onOpenAssistantChat) return
      onOpenAssistantChat(assistantId)
      onOpenChange(false)
    },
    [onOpenAssistantChat, onOpenChange]
  )

  const handlePreviewOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen || previewAdding) return
      setPreviewPreset(null)
    },
    [previewAdding]
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          size="xl"
          className="flex h-[min(600px,76vh)] flex-col gap-0 overflow-hidden p-0 pb-3"
          data-testid="assistant-library-dialog">
          <DialogHeader className="shrink-0 px-5 pt-5 pb-3 text-left">
            <DialogTitle>{t('library.assistant_catalog.title')}</DialogTitle>
          </DialogHeader>

          <div className="flex shrink-0 items-center gap-3 border-border-muted border-b px-5 pb-3">
            <div
              className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              data-testid="library-tabs">
              <div className="flex items-center gap-1">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTab
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      data-active={isActive}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'h-8 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm transition-colors',
                        isActive
                          ? 'bg-secondary font-medium text-secondary-foreground'
                          : 'font-normal text-foreground-muted hover:bg-accent hover:text-foreground'
                      )}>
                      {tab.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="relative w-52 shrink-0">
              <Search size={14} className="-translate-y-1/2 absolute top-1/2 left-2.5 text-foreground-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('library.toolbar.search_placeholder')}
                className="h-8 rounded-lg border-input bg-background pr-8 pl-8 text-sm placeholder:text-foreground-muted"
              />
              {search && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.clear')}
                  onClick={() => setSearch('')}
                  className="-translate-y-1/2 absolute top-1/2 right-1 size-6 text-foreground-muted hover:text-foreground">
                  <X size={13} />
                </Button>
              )}
            </div>
          </div>

          <div
            ref={listScrollRef}
            aria-busy={isLoading || undefined}
            className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-1">
            {isLoading ? (
              <AssistantLibraryPresetListSkeleton />
            ) : visiblePresets.length === 0 ? (
              <EmptyState
                preset={search ? 'no-result' : 'no-resource'}
                title={
                  search ? t('library.assistant_catalog.no_match_title') : t('library.assistant_catalog.empty_title')
                }
                description={
                  search
                    ? t('library.assistant_catalog.no_match_description')
                    : t('library.assistant_catalog.empty_description')
                }
                className="py-16"
              />
            ) : (
              <VirtualizedAssistantLibraryPresetList
                scrollRef={listScrollRef}
                presets={visiblePresets}
                addingPresetKeys={addingPresetKeys}
                addedAssistantPresets={addedAssistantPresets}
                onAddPreset={handleAddPreset}
                onOpenChat={handleOpenChat}
                onPreviewPreset={setPreviewPreset}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AssistantPresetPreviewDialog
        preset={previewPreset}
        open={Boolean(previewPreset)}
        adding={previewAdding}
        addedAssistantId={
          previewPreset ? addedAssistantPresets[getAssistantPresetCatalogKey(previewPreset)] : undefined
        }
        onOpenChange={handlePreviewOpenChange}
        onAdd={handleAddPreviewPreset}
        onOpenChat={handleOpenChat}
      />
    </>
  )
}

function AssistantLibraryPresetListSkeleton() {
  return (
    <div className="flex flex-col gap-2" data-testid="assistant-library-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-lg border border-border-subtle bg-card px-3.5 py-2.5">
          <Skeleton className="size-9 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
      ))}
    </div>
  )
}

type VirtualizedAssistantLibraryPresetListProps = {
  scrollRef: RefObject<HTMLDivElement | null>
  presets: AssistantCatalogPreset[]
  addingPresetKeys: Set<string>
  addedAssistantPresets: Record<string, string>
  onAddPreset: (preset: AssistantCatalogPreset) => void
  onOpenChat: (assistantId: string) => void
  onPreviewPreset: (preset: AssistantCatalogPreset) => void
}

function VirtualizedAssistantLibraryPresetList({
  scrollRef,
  presets,
  addingPresetKeys,
  addedAssistantPresets,
  onAddPreset,
  onOpenChat,
  onPreviewPreset
}: VirtualizedAssistantLibraryPresetListProps) {
  const rowVirtualizer = useVirtualizer({
    count: presets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PRESET_ROW_ESTIMATE_PX + PRESET_ROW_GAP_PX,
    overscan: 6
  })

  return (
    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const preset = presets[virtualRow.index]
        if (!preset) return null

        const presetKey = getAssistantPresetCatalogKey(preset)
        return (
          <div
            key={virtualRow.key}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className="pb-2"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`
            }}>
            <AssistantLibraryPresetRow
              preset={preset}
              adding={addingPresetKeys.has(presetKey)}
              addedAssistantId={addedAssistantPresets[presetKey]}
              onAddPreset={onAddPreset}
              onOpenChat={onOpenChat}
              onPreviewPreset={onPreviewPreset}
            />
          </div>
        )
      })}
    </div>
  )
}

type AssistantLibraryPresetRowProps = {
  preset: AssistantCatalogPreset
  adding: boolean
  addedAssistantId?: string
  onAddPreset: (preset: AssistantCatalogPreset) => void
  onOpenChat: (assistantId: string) => void
  onPreviewPreset: (preset: AssistantCatalogPreset) => void
}

const AssistantLibraryPresetRow = memo(function AssistantLibraryPresetRow({
  preset,
  adding,
  addedAssistantId,
  onAddPreset,
  onOpenChat,
  onPreviewPreset
}: AssistantLibraryPresetRowProps) {
  const { t } = useTranslation()
  const summary = getPresetSummary(preset)
  const isAdded = Boolean(addedAssistantId)
  const handleAdd = useCallback(() => {
    onAddPreset(preset)
  }, [onAddPreset, preset])
  const handlePreview = useCallback(() => {
    onPreviewPreset(preset)
  }, [onPreviewPreset, preset])

  const activateOnKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handlePreview()
      }
    },
    [handlePreview]
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={preset.name}
      onClick={handlePreview}
      onKeyDown={activateOnKeyDown}
      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-border-subtle bg-card px-3.5 py-2.5 transition-[border-color,background-color] hover:border-border-hover hover:bg-accent">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-base">
        {preset.emoji || '🤖'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground text-sm leading-5">{preset.name}</div>
        {summary && <div className="truncate text-foreground-secondary text-xs leading-4">{summary}</div>}
      </div>
      {/* stopPropagation so the quick add/open action never bubbles to the row's preview. */}
      <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
        {isAdded ? (
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-success hover:text-success')}
            onClick={() => onOpenChat(addedAssistantId as string)}>
            <Check size={13} />
            <span>{t('library.assistant_catalog.go_to_chat')}</span>
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="h-7 gap-1 px-2.5" loading={adding} onClick={handleAdd}>
            {!adding && <Plus size={13} />}
            <span>{t('library.assistant_catalog.add')}</span>
          </Button>
        )}
      </div>
    </div>
  )
})
