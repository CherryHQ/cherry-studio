import { HorizontalScrollContainer, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import { CommandTooltip } from '@renderer/components/command'
import { RightSidebarCollapseIcon, RightSidebarExpandIcon } from '@renderer/components/icons/SidebarToggleIcons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useCommandHandler } from '@renderer/hooks/command'
import { cn } from '@renderer/utils/style'
import type { CommandId } from '@shared/utils/command'
import { Maximize2, Minimize2, X } from 'lucide-react'
import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useChatMaximizedOverlayBottomInset } from '../../layout/ChatViewportInsetContext'
import {
  ARTIFACT_RIGHT_PANE_CACHE_KEY,
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  CHAT_CENTER_MIN_USABLE_WIDTH
} from '../../shell/paneLayout'
import { RightPaneHost } from '../../shell/RightPaneHost'

// ── Generic tabbed side-pane shell ──────────────────────────────────────────
// Knows only about open/maximized/inset/activeTab. Tabs and their content are
// composed in by the consumer via <Shell.Tab> / <Shell.Panel>.

export interface ShellState {
  open: boolean
  maximized: boolean
  activeTab: string
  /** True from a maximize/minimize request until the viewport's layout animation completes. */
  layoutAnimationPending: boolean
  pdfLayoutPending: boolean
  pdfLayoutRefreshKey: number
}

export interface ShellActions {
  close: (afterClose?: () => void) => void
  finishClose: () => void
  minimize: () => void
  openTab: (tab: string) => void
  reconcileTab: (tab: string) => void
  toggleMaximized: () => void
  refreshPdfLayout: () => void
}

export type ShellTabShortcutOpenBehavior = 'hide' | 'toggle-active'

interface ShellContextValue {
  state: ShellState
  actions: ShellActions
}

const ShellStateContext = createContext<ShellState | null>(null)
const ShellActionsContext = createContext<ShellActions | null>(null)

function useShell(): ShellContextValue {
  return {
    state: useShellState(),
    actions: useShellActions()
  }
}

export function useShellActions(): ShellActions {
  const actions = use(ShellActionsContext)
  if (!actions) throw new Error('useShellActions must be used within <Shell>')
  return actions
}

export function useOptionalShellActions(): ShellActions | undefined {
  return use(ShellActionsContext) ?? undefined
}

export function useShellState(): ShellState {
  const state = use(ShellStateContext)
  if (!state) throw new Error('useShellState must be used within <Shell>')
  return state
}

export function useOptionalShellState(): ShellState | undefined {
  return use(ShellStateContext) ?? undefined
}

function ShellProvider({
  children,
  defaultTab,
  defaultOpen = false,
  onOpenChange
}: {
  children: ReactNode
  defaultTab: string
  defaultOpen?: boolean
  /**
   * Notified for explicit shell open/close changes. Capability reconciliation
   * changes only the selected tab and never reports a synthetic close.
   */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [maximized, setMaximized] = useState(false)
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [layoutAnimationPending, setLayoutAnimationPending] = useState(false)
  const [pdfLayoutPending, setPdfLayoutPending] = useState(false)
  const [pdfLayoutRefreshKey, setPdfLayoutRefreshKey] = useState(0)
  const openRef = useRef(open)
  const closeCallbacksRef = useRef<Array<() => void>>([])
  // Held in a ref so the open/close actions stay referentially stable (no memo churn for consumers).
  const onOpenChangeRef = useRef(onOpenChange)

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  useEffect(() => {
    openRef.current = open
  }, [open])

  const finishClose = useCallback(() => {
    // A close can interrupt a maximize/minimize; its completion must not leave the flag stuck.
    setLayoutAnimationPending(false)
    const callbacks = closeCallbacksRef.current
    closeCallbacksRef.current = []
    for (const callback of callbacks) callback()
  }, [])

  useEffect(() => {
    if (openRef.current === defaultOpen) return

    openRef.current = defaultOpen
    setOpen(defaultOpen)
    if (defaultOpen) {
      setActiveTab(defaultTab)
      setPdfLayoutPending(true)
    } else {
      setMaximized(false)
      setPdfLayoutPending(false)
      finishClose()
    }
  }, [defaultOpen, defaultTab, finishClose])

  const close = useCallback((afterClose?: () => void) => {
    if (!openRef.current) {
      afterClose?.()
      return
    }
    openRef.current = false
    if (afterClose) {
      closeCallbacksRef.current.push(afterClose)
    }
    setOpen(false)
    setMaximized(false)
    setPdfLayoutPending(false)
    onOpenChangeRef.current?.(false)
  }, [])
  const openTab = useCallback((tab: string) => {
    setActiveTab(tab)
    openRef.current = true
    setOpen((currentOpen) => {
      if (!currentOpen) setPdfLayoutPending(true)
      return true
    })
    onOpenChangeRef.current?.(true)
  }, [])
  const reconcileTab = useCallback((tab: string) => {
    setActiveTab(tab)
  }, [])
  const minimize = useCallback(() => {
    setLayoutAnimationPending(true)
    setPdfLayoutPending(false)
    setMaximized(false)
  }, [])
  const toggleMaximized = useCallback(() => {
    setLayoutAnimationPending(true)
    setPdfLayoutPending(false)
    setMaximized((currentMaximized) => !currentMaximized)
  }, [])
  const refreshPdfLayout = useCallback(() => {
    setLayoutAnimationPending(false)
    setPdfLayoutPending(false)
    setPdfLayoutRefreshKey((key) => key + 1)
  }, [])

  const state = useMemo<ShellState>(
    () => ({ open, maximized, activeTab, layoutAnimationPending, pdfLayoutPending, pdfLayoutRefreshKey }),
    [activeTab, layoutAnimationPending, maximized, open, pdfLayoutPending, pdfLayoutRefreshKey]
  )
  const actions = useMemo<ShellActions>(
    () => ({ close, finishClose, minimize, openTab, reconcileTab, toggleMaximized, refreshPdfLayout }),
    [close, finishClose, minimize, openTab, reconcileTab, refreshPdfLayout, toggleMaximized]
  )

  return (
    <ShellActionsContext value={actions}>
      <ShellStateContext value={state}>{children}</ShellStateContext>
    </ShellActionsContext>
  )
}

// A single persistent viewport owns the pane subtree across closed, docked,
// and maximized layouts. RightPaneHost moves only its empty spacer and clips
// this surface, so stateful descendants never cross React ownership boundaries.
function ShellViewport({ children, open }: { children: ReactNode; open?: boolean }) {
  const { state, actions } = useShell()
  const bottomInset = useChatMaximizedOverlayBottomInset()
  const presentationOpen = open ?? state.open
  const handleLayoutAnimationComplete = useCallback(
    (mode: 'closed' | 'docked' | 'maximized') => {
      if (mode === 'closed') {
        actions.finishClose()
        return
      }
      actions.refreshPdfLayout()
    },
    [actions]
  )

  return (
    <RightPaneHost
      open={presentationOpen}
      keepMounted
      maximized={state.maximized}
      maximizedBottomInset={bottomInset}
      width={ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH}
      resizable
      minWidth={ARTIFACT_RIGHT_PANE_MIN_WIDTH}
      defaultWidth={ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH}
      maxWidth={ARTIFACT_RIGHT_PANE_MAX_WIDTH}
      cacheKey={ARTIFACT_RIGHT_PANE_CACHE_KEY}
      reservedCenterWidth={CHAT_CENTER_MIN_USABLE_WIDTH}
      onLayoutAnimationComplete={handleLayoutAnimationComplete}>
      {children}
    </RightPaneHost>
  )
}

// Navbar button that opens the side pane to a given tab (or collapses it).
/** Registers the side-pane toggle as a keyboard command; renders nothing. */
function ShellToggleShortcut({
  command,
  onTrigger,
  enabled
}: {
  command: CommandId
  onTrigger: () => void
  enabled: boolean
}) {
  useCommandHandler(command, onTrigger, { enabled })
  return null
}

function ShellToggle({
  tab,
  disabled = false,
  command,
  commandEnabled = true
}: {
  tab: string
  disabled?: boolean
  command?: CommandId
  /** Gates the keyboard command (e.g. only the active tab handles it); the button stays clickable. */
  commandEnabled?: boolean
}) {
  const { state, actions } = useShell()
  const { t } = useTranslation()
  const pressed = state.open
  const ToggleIcon = pressed ? RightSidebarCollapseIcon : RightSidebarExpandIcon
  const toggleLabel = pressed ? t('common.close_sidebar') : t('common.open_sidebar')
  const handleClick = useCallback(() => {
    if (state.open) {
      actions.close()
      return
    }
    actions.openTab(tab)
  }, [actions, state.open, tab])

  const button = (
    <NavbarIcon
      tone="conversation"
      active={pressed}
      disabled={disabled}
      onClick={handleClick}
      aria-pressed={pressed}
      aria-label={toggleLabel}
      data-state={pressed ? 'open' : 'closed'}>
      <ToggleIcon />
    </NavbarIcon>
  )

  if (command) {
    return (
      <>
        <ShellToggleShortcut command={command} onTrigger={handleClick} enabled={commandEnabled && !disabled} />
        <CommandTooltip command={command} label={toggleLabel} delay={800}>
          {button}
        </CommandTooltip>
      </>
    )
  }

  return (
    <Tooltip content={toggleLabel} delay={800}>
      {button}
    </Tooltip>
  )
}

function ShellTabShortcut({
  tab,
  label,
  icon,
  disabled = false,
  tooltip,
  openBehavior = 'hide',
  className,
  onClick,
  ...buttonProps
}: Omit<ComponentProps<typeof NavbarIcon>, 'aria-label' | 'children' | 'onClick'> & {
  tab: string
  label: string
  icon: ReactNode
  tooltip?: ReactNode | false
  openBehavior?: ShellTabShortcutOpenBehavior
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const { state, actions } = useShell()
  const active = state.open && state.activeTab === tab
  const togglesActive = openBehavior === 'toggle-active'
  const ariaLabel = label
  const tooltipContent = tooltip === false ? false : (tooltip ?? ariaLabel)
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      if (togglesActive && state.open && state.activeTab === tab) {
        actions.close()
        return
      }
      actions.openTab(tab)
    },
    [actions, onClick, state.activeTab, state.open, tab, togglesActive]
  )

  if (state.maximized || (state.open && openBehavior === 'hide')) return null

  const button = (
    <NavbarIcon
      {...buttonProps}
      tone="conversation"
      className={cn('[&_svg]:!size-3.5 shrink-0', className)}
      active={active}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={togglesActive ? active : undefined}
      data-shell-tab-shortcut={tab}
      onClick={handleClick}>
      {icon}
    </NavbarIcon>
  )

  if (tooltipContent === false) return button

  return (
    <Tooltip content={tooltipContent} delay={800}>
      {button}
    </Tooltip>
  )
}

function ShellTabs({ children, value }: { children: ReactNode; value?: string }) {
  const { state, actions } = useShell()
  return (
    <Tabs
      value={value ?? state.activeTab}
      onValueChange={actions.openTab}
      variant="line"
      className="h-full gap-0 overflow-hidden text-card-foreground">
      {children}
    </Tabs>
  )
}

// Header bar: the tab strip plus the pane-level maximize toggle.
// `extraTrailing` hosts pane-header-only controls. Consumers that keep pane entries outside the
// pane can switch this header to title mode and leave the entry cluster in ConversationShell.
function ShellTabList({
  children,
  extraTrailing,
  title,
  showTabs = true
}: {
  children?: ReactNode
  extraTrailing?: ReactNode
  title?: ReactNode
  showTabs?: boolean
}) {
  const { state, actions } = useShell()
  const { t } = useTranslation()
  const maximizeLabel = t(state.maximized ? 'common.minimize' : 'common.maximize')
  const MaximizeIcon = state.maximized ? Minimize2 : Maximize2
  const closeLabel = t('common.close_sidebar')
  const maximizeButton = (
    <Tooltip content={maximizeLabel} delay={800}>
      <NavbarIcon
        tone="conversation"
        className="[&_svg]:!size-3.5 shrink-0"
        aria-label={maximizeLabel}
        aria-pressed={state.maximized}
        onClick={actions.toggleMaximized}>
        <MaximizeIcon />
      </NavbarIcon>
    </Tooltip>
  )
  const closeButton = (
    <Tooltip content={closeLabel} delay={800}>
      <NavbarIcon tone="conversation" aria-label={closeLabel} onClick={() => actions.close()}>
        <RightSidebarCollapseIcon />
      </NavbarIcon>
    </Tooltip>
  )
  return (
    <div
      data-testid="shell-tab-list"
      className={cn(
        // Match ConversationShell's edge inset so the closed-state expand button and
        // opened-state close button keep the same distance from the nearest edge.
        'flex h-(--navbar-height) shrink-0 items-center justify-between gap-2 border-border-subtle border-b px-2 [-webkit-app-region:no-drag]'
      )}>
      {showTabs ? (
        <HorizontalScrollContainer className="min-w-0 flex-1" gap="4px" scrollDistance={180}>
          <TabsList className="min-w-max justify-start gap-1 [-webkit-app-region:no-drag]">{children}</TabsList>
        </HorizontalScrollContainer>
      ) : (
        <div
          data-testid="shell-tab-title"
          className="min-w-0 flex-1 select-none truncate px-1 font-medium text-foreground text-sm">
          {title}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
        {showTabs ? (
          <>
            {maximizeButton}
            {extraTrailing}
          </>
        ) : (
          <>
            {extraTrailing}
            {maximizeButton}
            {closeButton}
          </>
        )}
      </div>
    </div>
  )
}

// Rounded pill tab mirroring the top window tab bar (AppShellTabBar).
const SHELL_TAB_CLASS =
  'h-[30px] shrink-0 gap-1.5 rounded-[10px] px-2 font-medium text-[11px] text-muted-foreground ' +
  'transition-colors duration-150 after:hidden hover:bg-black/6 hover:text-foreground dark:hover:bg-white/6 ' +
  'data-[state=active]:bg-black/8 data-[state=active]:text-foreground dark:data-[state=active]:bg-white/10'

interface ShellTabProps {
  value: string
  icon?: ReactNode
  badge?: ReactNode
  /** When provided, a close button appears on hover. */
  onClose?: () => void
  children: ReactNode
}

function ShellTab({ value, icon, badge, onClose, children }: ShellTabProps) {
  const { t } = useTranslation()

  if (!onClose) {
    return (
      <TabsTrigger value={value} className={SHELL_TAB_CLASS}>
        {icon}
        {children}
        {badge}
      </TabsTrigger>
    )
  }

  return (
    <div className="group relative shrink-0">
      <TabsTrigger value={value} className={cn(SHELL_TAB_CLASS, 'max-w-40 pr-7')}>
        {icon}
        <span className="min-w-0 truncate">{children}</span>
        {badge}
      </TabsTrigger>
      <div
        role="button"
        tabIndex={0}
        aria-label={t('common.close')}
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClose()
          }
        }}
        className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-all duration-150 hover:bg-foreground/10 hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <X size={11} />
      </div>
    </div>
  )
}

/**
 * Pass `forceMount` for panels whose children own state that's expensive
 * to rebuild on every show — e.g. the workspace file tree, which would
 * otherwise re-serialize + rematerialize + re-index O(N) nodes every time
 * the user toggles between tabs. Default (omitted): radix's standard
 * "unmount when inactive" behaviour.
 *
 * NB: with `forceMount`, radix keeps the subtree in the DOM but does NOT
 * set the `hidden` attribute (because `Presence.present` stays true). The
 * consumer has to enforce hiding via `data-[state=inactive]`, otherwise
 * the kept-alive panel renders *on top of* whichever tab is active.
 */
function ShellPanel({
  value,
  className,
  forceMount,
  children
}: {
  value: string
  className?: string
  forceMount?: boolean
  children: ReactNode
}) {
  return (
    <TabsContent
      value={value}
      className={cn('min-h-0 overflow-hidden', forceMount && 'data-[state=inactive]:hidden', className)}
      {...(forceMount ? { forceMount: true as const } : {})}>
      {children}
    </TabsContent>
  )
}

// `Shell` is the provider itself, with the other parts attached as statics —
// so it is used as `<Shell>` / `<Shell.Viewport>` rather than `<Shell.Provider>`.
export const Shell = Object.assign(ShellProvider, {
  Viewport: ShellViewport,
  Toggle: ShellToggle,
  TabShortcut: ShellTabShortcut,
  Tabs: ShellTabs,
  TabList: ShellTabList,
  Tab: ShellTab,
  Panel: ShellPanel
})
