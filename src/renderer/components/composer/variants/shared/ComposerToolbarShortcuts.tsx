import { Button, Popover, PopoverAnchor, PopoverContent, ReorderableList, Switch, Tooltip } from '@cherrystudio/ui'
import {
  useComposerToolLauncherController,
  useComposerToolLauncherVersion
} from '@renderer/components/composer/ComposerToolRuntime'
import type { ComposerUnifiedPanelControl } from '@renderer/components/composer/quickPanel'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { cn } from '@renderer/utils/style'
import { GripVertical, RotateCcw } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { COMPOSER_SEND_ACCESSORY_BUTTON_CLASS } from './ComposerControlScaffolding'

/** Variant-provided shortcut that is not backed by a launcher (e.g. agent skills). */
export interface ComposerToolbarCustomTool {
  id: string
  label: string
  icon: ReactNode
  onSelect: (args: { inputAdapter?: QuickPanelInputAdapter; unifiedPanelControl?: ComposerUnifiedPanelControl }) => void
}

interface ShortcutCandidate {
  id: string
  label: ReactNode | string
  icon: ReactNode
  active: boolean
  disabled: boolean
  disabledReason?: ReactNode | string
  /** Hint shown even when clickable (e.g. Attachment "image not supported" in doc-only mode). */
  tooltip?: ReactNode | string
  /**
   * Popup announced via `aria-haspopup`: `'menu'` opens the unified panel, `'dialog'`
   * opens a modal (e.g. the attachment picker). Absent for plain toggle commands.
   */
  haspopup?: 'menu' | 'dialog'
  /** True only for genuine on/off toggles (command launchers); drives `aria-pressed`. */
  toggle: boolean
  select: () => void
}

interface ComposerToolbarShortcutsProps {
  pinnedIds: readonly string[]
  onPinnedIdsChange: (next: string[]) => void
  onResetPinnedIds: () => void
  /** True when the pinned list already equals the default — disables the reset control. */
  isDefault: boolean
  customTools?: readonly ComposerToolbarCustomTool[]
  customizeOpen: boolean
  onCustomizeOpenChange: (open: boolean) => void
  inputAdapter?: QuickPanelInputAdapter
  unifiedPanelControl?: ComposerUnifiedPanelControl
}

interface CustomizeRow {
  id: string
  candidate?: ShortcutCandidate
}

interface CustomizeOrderState {
  preferredOrder: string[]
  syncedPinnedIds: readonly string[]
  pendingPinnedIds: readonly string[] | null
}

const CUSTOMIZE_ROW_CLASS = 'flex h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-accent/60'
const CUSTOMIZE_ROW_ICON_CLASS =
  'flex size-5 shrink-0 items-center justify-center text-foreground/70 [&_svg]:!size-[16px]'

const haveSameOrder = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index])

const reconcileCustomizeOrder = (
  preferredOrder: readonly string[],
  pinnedIds: readonly string[],
  candidateIds: readonly string[]
) => {
  const availableIds = new Set([...pinnedIds, ...candidateIds])
  const nextOrder: string[] = []
  const seenIds = new Set<string>()

  for (const id of [...preferredOrder, ...pinnedIds, ...candidateIds]) {
    if (availableIds.has(id) && !seenIds.has(id)) {
      seenIds.add(id)
      nextOrder.push(id)
    }
  }

  return nextOrder
}

/**
 * User-customizable persistent tool shortcut bar shared by the composer variants.
 * Renders the pinned tool ids that resolve to a live candidate (launcher registered
 * for the current scope/model, or a variant-provided custom tool); stale ids stay in
 * the preference untouched. The customize popover (opened from the "+" panel's
 * bottom-fixed item) keeps all candidates in one draggable list, with a switch toggling
 * whether each tool is pinned.
 */
export const ComposerToolbarShortcuts = ({
  pinnedIds,
  onPinnedIdsChange,
  onResetPinnedIds,
  isDefault,
  customTools,
  customizeOpen,
  onCustomizeOpenChange,
  inputAdapter,
  unifiedPanelControl
}: ComposerToolbarShortcutsProps) => {
  const { t } = useTranslation()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const toolLaunchersVersion = useComposerToolLauncherVersion()
  const panelUnavailable = !unifiedPanelControl?.available

  const candidates = useMemo<ShortcutCandidate[]>(() => {
    void toolLaunchersVersion
    const launcherCandidates = getLaunchers('popover').map((launcher): ShortcutCandidate => {
      // group/panel launchers open the unified panel; dialog launchers open a modal
      // (attachment picker); command launchers are plain on/off toggles.
      const opensPanel = launcher.kind === 'group' || launcher.kind === 'panel'
      const label = launcher.label
      return {
        id: launcher.id,
        label,
        icon: launcher.icon,
        active: Boolean(launcher.active),
        disabled: Boolean(launcher.disabled) || (opensPanel && panelUnavailable),
        disabledReason: launcher.disabledReason,
        tooltip: launcher.tooltip,
        haspopup: opensPanel ? 'menu' : launcher.kind === 'dialog' ? 'dialog' : undefined,
        toggle: launcher.kind === 'command',
        select: opensPanel
          ? () =>
              unifiedPanelControl?.open({
                launcherId: launcher.id,
                searchText: typeof label === 'string' ? label : undefined
              })
          : () => dispatchLauncher(launcher, { source: 'popover', inputAdapter })
      }
    })
    const customCandidates = (customTools ?? []).map(
      (tool): ShortcutCandidate => ({
        id: tool.id,
        label: tool.label,
        icon: tool.icon,
        active: false,
        disabled: panelUnavailable,
        haspopup: 'menu',
        toggle: false,
        select: () => tool.onSelect({ inputAdapter, unifiedPanelControl })
      })
    )
    return [...launcherCandidates, ...customCandidates]
  }, [
    customTools,
    dispatchLauncher,
    getLaunchers,
    inputAdapter,
    panelUnavailable,
    toolLaunchersVersion,
    unifiedPanelControl
  ])

  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates])

  // Stale pinned ids (tool not registered for the current scope/model) keep their
  // row so reordering preserves them in the preference; only resolved rows render.
  const pinnedRows = useMemo<CustomizeRow[]>(
    () => pinnedIds.map((id) => ({ id, candidate: candidateById.get(id) })),
    [candidateById, pinnedIds]
  )
  const visiblePinnedRows = useMemo(() => pinnedRows.filter((row) => row.candidate), [pinnedRows])
  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
  const candidateIds = useMemo(() => candidates.map((candidate) => candidate.id), [candidates])
  const [customizeOrderState, setCustomizeOrderState] = useState<CustomizeOrderState>(() => ({
    preferredOrder: [],
    syncedPinnedIds: pinnedIds,
    pendingPinnedIds: null
  }))

  if (!haveSameOrder(customizeOrderState.syncedPinnedIds, pinnedIds)) {
    const isLocalPreferenceUpdate =
      customizeOrderState.pendingPinnedIds !== null && haveSameOrder(customizeOrderState.pendingPinnedIds, pinnedIds)

    // Adjust before rendering children so external updates and optimistic rollbacks
    // never commit a frame using the stale local full-list order.
    setCustomizeOrderState({
      preferredOrder: isLocalPreferenceUpdate ? customizeOrderState.preferredOrder : [],
      syncedPinnedIds: pinnedIds,
      pendingPinnedIds: null
    })
  }

  const customizeOrderIds = useMemo(
    () => reconcileCustomizeOrder(customizeOrderState.preferredOrder, pinnedIds, candidateIds),
    [candidateIds, customizeOrderState.preferredOrder, pinnedIds]
  )
  const customizeRows = useMemo<CustomizeRow[]>(
    () => customizeOrderIds.map((id) => ({ id, candidate: candidateById.get(id) })),
    [candidateById, customizeOrderIds]
  )
  const visibleCustomizeRows = useMemo(() => customizeRows.filter((row) => row.candidate), [customizeRows])

  const customizeLabel = t('chat.input.toolbar.customize')
  const customizeTitleId = useId()

  const requestPinnedIdsChange = (nextPinnedIds: string[]) => {
    setCustomizeOrderState((current) => ({ ...current, pendingPinnedIds: nextPinnedIds }))
    onPinnedIdsChange(nextPinnedIds)
  }

  const togglePinned = (id: string, checked: boolean) => {
    const nextPinnedIdSet = new Set(pinnedIds)
    if (checked) {
      nextPinnedIdSet.add(id)
    } else {
      nextPinnedIdSet.delete(id)
    }
    requestPinnedIdsChange(customizeOrderIds.filter((candidateId) => nextPinnedIdSet.has(candidateId)))
  }

  const reorderCustomizeRows = (nextRows: CustomizeRow[]) => {
    const nextOrderIds = nextRows.map((row) => row.id)
    setCustomizeOrderState((current) => ({ ...current, preferredOrder: nextOrderIds }))

    const nextPinnedIds = nextOrderIds.filter((id) => pinnedIdSet.has(id))
    if (nextPinnedIds.length !== pinnedIds.length || nextPinnedIds.some((id, index) => id !== pinnedIds[index])) {
      requestPinnedIdsChange(nextPinnedIds)
    }
  }

  const resetPinnedIds = () => {
    setCustomizeOrderState({ preferredOrder: [], syncedPinnedIds: pinnedIds, pendingPinnedIds: null })
    onResetPinnedIds()
  }

  // Localized drag feedback so screen readers announce tool names, not internal ids (e.g. "web-search").
  const dragAccessibility = useMemo(() => {
    const nameOf = (id: string | number) => {
      const label = candidateById.get(String(id))?.label
      return typeof label === 'string' ? label : String(id)
    }
    return {
      screenReaderInstructions: { draggable: t('chat.input.toolbar.drag.instructions') },
      announcements: {
        onDragStart: ({ active }) => t('chat.input.toolbar.drag.picked_up', { name: nameOf(active.id) }),
        onDragOver: ({ active, over }) =>
          over ? t('chat.input.toolbar.drag.over', { name: nameOf(active.id), over: nameOf(over.id) }) : undefined,
        onDragEnd: ({ active }) => t('chat.input.toolbar.drag.dropped', { name: nameOf(active.id) }),
        onDragCancel: ({ active }) => t('chat.input.toolbar.drag.cancelled', { name: nameOf(active.id) })
      }
    } satisfies ComponentProps<typeof ReorderableList<CustomizeRow>>['accessibility']
  }, [candidateById, t])

  return (
    <Popover open={customizeOpen} onOpenChange={onCustomizeOpenChange}>
      <PopoverAnchor asChild>
        <div className="flex shrink-0 items-center gap-1.5">
          {visiblePinnedRows.map(({ candidate }) => {
            const shortcut = candidate!
            const tooltip =
              shortcut.disabled && shortcut.disabledReason
                ? shortcut.disabledReason
                : (shortcut.tooltip ?? shortcut.label)
            return (
              <Tooltip key={shortcut.id} content={tooltip} placement="top">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    COMPOSER_SEND_ACCESSORY_BUTTON_CLASS,
                    'disabled:pointer-events-none disabled:opacity-40',
                    shortcut.active && 'bg-accent'
                  )}
                  aria-label={typeof shortcut.label === 'string' ? shortcut.label : undefined}
                  aria-haspopup={shortcut.haspopup}
                  aria-pressed={shortcut.toggle ? shortcut.active : undefined}
                  disabled={shortcut.disabled}
                  data-active={shortcut.active || undefined}
                  onClick={shortcut.select}>
                  {shortcut.icon}
                </Button>
              </Tooltip>
            )
          })}
        </div>
      </PopoverAnchor>
      {/* The "+" panel entry restores focus to the editor right after opening; ignore
          focus-outside so that restore doesn't instantly dismiss. Pointer-down outside
          still closes the popover. */}
      <PopoverContent
        align="start"
        className="w-64 p-1.5"
        aria-labelledby={customizeTitleId}
        onFocusOutside={(event) => event.preventDefault()}>
        <div id={customizeTitleId} className="px-2 py-1 font-medium text-foreground text-sm">
          {customizeLabel}
        </div>
        <ReorderableList
          items={customizeRows}
          visibleItems={visibleCustomizeRows}
          getId={(row) => row.id}
          onReorder={reorderCustomizeRows}
          direction="vertical"
          gap={1}
          // The drag activator lives on the grip handle (below), not the whole row,
          // so the row stays non-interactive and the Switch keeps its own control boundary.
          dragHandle
          accessibility={dragAccessibility}
          itemStyle={{ cursor: 'default' }}
          renderItem={(row, _index, { dragging, dragHandleProps }) => {
            const candidate = row.candidate
            if (!candidate) return null
            const label = typeof candidate.label === 'string' ? candidate.label : undefined
            return (
              <div className={CUSTOMIZE_ROW_CLASS}>
                <button
                  type="button"
                  ref={dragHandleProps?.ref}
                  {...dragHandleProps?.attributes}
                  {...dragHandleProps?.listeners}
                  data-dragging={dragging ? 'true' : 'false'}
                  aria-label={t('chat.input.toolbar.drag_handle', { name: label ?? '' })}
                  // touch-none: let the PointerSensor own touch gestures so a scroll doesn't
                  // pointer-cancel the drag before the activation distance is met.
                  className="flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing data-[dragging=true]:cursor-grabbing data-[dragging=true]:text-foreground">
                  <GripVertical className="size-3.5" />
                </button>
                <span className={CUSTOMIZE_ROW_ICON_CLASS}>{candidate.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{candidate.label}</span>
                <Switch
                  size="xs"
                  checked={pinnedIdSet.has(row.id)}
                  data-tool-toggle-id={row.id}
                  aria-label={label}
                  onCheckedChange={(checked) => togglePinned(row.id, checked)}
                />
              </div>
            )
          }}
        />
        <div className="mx-1.5 mt-1 border-border border-t pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start px-1.5 text-muted-foreground text-sm hover:text-foreground"
            disabled={isDefault}
            onClick={resetPinnedIds}>
            <RotateCcw className="size-4" />
            {t('chat.input.toolbar.restore_default')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
