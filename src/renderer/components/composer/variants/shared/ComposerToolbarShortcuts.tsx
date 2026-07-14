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
import { useEffect, useId, useMemo, useRef } from 'react'
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

interface PinnedRow {
  id: string
  candidate?: ShortcutCandidate
}

const CUSTOMIZE_ROW_CLASS = 'group flex h-9 items-center gap-2 rounded-lg px-2 hover:bg-accent/60'
const CUSTOMIZE_ROW_ICON_CLASS =
  'flex size-5 shrink-0 items-center justify-center text-foreground/70 [&_svg]:!size-[16px]'

/**
 * User-customizable persistent tool shortcut bar shared by the composer variants.
 * Renders the pinned tool ids that resolve to a live candidate (launcher registered
 * for the current scope/model, or a variant-provided custom tool); stale ids stay in
 * the preference untouched. The customize popover (opened from the "+" panel's
 * trailing item) lists pinned rows (drag to reorder) and the remaining candidates,
 * with a switch toggling membership.
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
  const pinnedRows = useMemo<PinnedRow[]>(
    () => pinnedIds.map((id) => ({ id, candidate: candidateById.get(id) })),
    [candidateById, pinnedIds]
  )
  const visiblePinnedRows = useMemo(() => pinnedRows.filter((row) => row.candidate), [pinnedRows])
  const unpinnedCandidates = useMemo(
    () => candidates.filter((candidate) => !pinnedIds.includes(candidate.id)),
    [candidates, pinnedIds]
  )

  const customizeLabel = t('chat.input.toolbar.customize')
  const customizeTitleId = useId()

  // Toggling a switch moves the tool between the pinned list and the unpinned list, which
  // unmounts/remounts its row and drops keyboard focus to <body>. Restore focus to the
  // tool's switch in its new location, keyed by tool id, after the list re-renders.
  const pendingFocusIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = pendingFocusIdRef.current
    if (!id) return
    pendingFocusIdRef.current = null
    const target = document.querySelector(`[data-tool-toggle-id="${CSS.escape(id)}"]`)
    if (target instanceof HTMLElement) target.focus()
  }, [pinnedIds])

  const togglePinned = (id: string, next: string[]) => {
    pendingFocusIdRef.current = id
    onPinnedIdsChange(next)
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
    } satisfies ComponentProps<typeof ReorderableList<PinnedRow>>['accessibility']
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
        className="w-72 p-2"
        aria-labelledby={customizeTitleId}
        onFocusOutside={(event) => event.preventDefault()}>
        <div id={customizeTitleId} className="px-2 pb-1.5 text-muted-foreground text-xs">
          {customizeLabel}
        </div>
        <ReorderableList
          items={pinnedRows}
          visibleItems={visiblePinnedRows}
          getId={(row) => row.id}
          onReorder={(nextRows) => onPinnedIdsChange(nextRows.map((row) => row.id))}
          direction="vertical"
          gap={2}
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
                  className="flex shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100 data-[dragging=true]:opacity-100">
                  <GripVertical className="size-4" />
                </button>
                <span className={CUSTOMIZE_ROW_ICON_CLASS}>{candidate.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{candidate.label}</span>
                <Switch
                  size="xs"
                  checked
                  data-tool-toggle-id={row.id}
                  aria-label={label}
                  onCheckedChange={() =>
                    togglePinned(
                      row.id,
                      pinnedIds.filter((id) => id !== row.id)
                    )
                  }
                />
              </div>
            )
          }}
        />
        {visiblePinnedRows.length > 0 && unpinnedCandidates.length > 0 ? (
          <div className="mx-2 my-1.5 border-border border-t" />
        ) : null}
        {unpinnedCandidates.map((candidate) => (
          <div key={candidate.id} className={CUSTOMIZE_ROW_CLASS}>
            <span className="size-4 shrink-0" aria-hidden />
            <span className={CUSTOMIZE_ROW_ICON_CLASS}>{candidate.icon}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{candidate.label}</span>
            <Switch
              size="xs"
              checked={false}
              data-tool-toggle-id={candidate.id}
              aria-label={typeof candidate.label === 'string' ? candidate.label : undefined}
              onCheckedChange={() => togglePinned(candidate.id, [...pinnedIds, candidate.id])}
            />
          </div>
        ))}
        <div className="mx-2 mt-1.5 border-border border-t pt-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start px-2 text-muted-foreground text-sm hover:text-foreground"
            disabled={isDefault}
            onClick={onResetPinnedIds}>
            <RotateCcw className="size-4" />
            {t('chat.input.toolbar.restore_default')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
