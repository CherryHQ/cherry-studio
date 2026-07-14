import { Button, Popover, PopoverAnchor, PopoverContent, ReorderableList, Switch, Tooltip } from '@cherrystudio/ui'
import {
  useComposerToolLauncherController,
  useComposerToolLauncherVersion
} from '@renderer/components/composer/ComposerToolRuntime'
import type { ComposerUnifiedPanelControl } from '@renderer/components/composer/quickPanel'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { cn } from '@renderer/utils/style'
import { GripVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import { useId, useMemo } from 'react'
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

  return (
    <Popover open={customizeOpen} onOpenChange={onCustomizeOpenChange}>
      <PopoverAnchor asChild>
        <div className="flex shrink-0 items-center gap-1.5">
          {visiblePinnedRows.map(({ candidate }) => {
            const shortcut = candidate!
            const tooltip = shortcut.disabled && shortcut.disabledReason ? shortcut.disabledReason : shortcut.label
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
          renderItem={(row, _index, { dragging }) => {
            const candidate = row.candidate
            if (!candidate) return null
            return (
              <div className={CUSTOMIZE_ROW_CLASS}>
                <span
                  aria-hidden
                  data-dragging={dragging ? 'true' : 'false'}
                  className="flex shrink-0 cursor-grab items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100 data-[dragging=true]:opacity-100">
                  <GripVertical className="size-4" />
                </span>
                <span className={CUSTOMIZE_ROW_ICON_CLASS}>{candidate.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{candidate.label}</span>
                <Switch
                  size="xs"
                  checked
                  aria-label={typeof candidate.label === 'string' ? candidate.label : undefined}
                  onCheckedChange={() => onPinnedIdsChange(pinnedIds.filter((id) => id !== row.id))}
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
              aria-label={typeof candidate.label === 'string' ? candidate.label : undefined}
              onCheckedChange={() => onPinnedIdsChange([...pinnedIds, candidate.id])}
            />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
