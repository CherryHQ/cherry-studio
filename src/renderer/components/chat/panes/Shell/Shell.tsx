import { HorizontalScrollContainer, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import { useWindowFrame } from '@renderer/components/chat/shell/WindowFrameContext'
import { CommandTooltip } from '@renderer/components/command'
import { RightSidebarCollapseIcon, RightSidebarExpandIcon } from '@renderer/components/Icons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { isMac } from '@renderer/config/constant'
import { useCommandHandler } from '@renderer/hooks/command'
import { cn } from '@renderer/utils'
import type { CommandId } from '@shared/utils/command/definitions'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
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
  pdfLayoutPending: boolean
  pdfLayoutRefreshKey: number
}

interface ShellActions {
  close: (afterClose?: () => void) => void
  finishClose: () => void
  openTab: (tab: string) => void
  toggleMaximized: () => void
  refreshPdfLayout: () => void
}

interface ShellContextValue {
  state: ShellState
  actions: ShellActions
}

const ShellContext = createContext<ShellContextValue | null>(null)

function useShell(): ShellContextValue {
  const value = use(ShellContext)
  if (!value) throw new Error('useShell must be used within <Shell>')
  return value
}

export function useShellActions(): ShellActions {
  return useShell().actions
}

export function useShellState(): ShellState {
  return useShell().state
}

export function useOptionalShellState(): ShellState | undefined {
  return use(ShellContext)?.state
}

function ShellProvider({ children, defaultTab }: { children: ReactNode; defaultTab: string }) {
  const [open, setOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [pdfLayoutPending, setPdfLayoutPending] = useState(false)
  const [pdfLayoutRefreshKey, setPdfLayoutRefreshKey] = useState(0)
  const openRef = useRef(open)
  const closeCallbacksRef = useRef<Array<() => void>>([])

  useEffect(() => {
    openRef.current = open
  }, [open])

  const finishClose = useCallback(() => {
    const callbacks = closeCallbacksRef.current
    closeCallbacksRef.current = []
    for (const callback of callbacks) callback()
  }, [])
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
  }, [])
  const openTab = useCallback((tab: string) => {
    setActiveTab(tab)
    openRef.current = true
    setOpen((currentOpen) => {
      if (!currentOpen) setPdfLayoutPending(true)
      return true
    })
  }, [])
  const toggleMaximized = useCallback(() => {
    setPdfLayoutPending(false)
    setMaximized((currentMaximized) => !currentMaximized)
  }, [])
  const refreshPdfLayout = useCallback(() => {
    setPdfLayoutPending(false)
    setPdfLayoutRefreshKey((key) => key + 1)
  }, [])

  const value = useMemo<ShellContextValue>(
    () => ({
      state: { open, maximized, activeTab, pdfLayoutPending, pdfLayoutRefreshKey },
      actions: { close, finishClose, openTab, toggleMaximized, refreshPdfLayout }
    }),
    [
      activeTab,
      close,
      finishClose,
      maximized,
      open,
      openTab,
      pdfLayoutPending,
      pdfLayoutRefreshKey,
      refreshPdfLayout,
      toggleMaximized
    ]
  )

  return <ShellContext value={value}>{children}</ShellContext>
}

// Docked, resizable side container. Unmounted entirely while maximized: the
// maximized surface lives in the overlay instead. Remounting on minimize lands
// inside RightPaneHost's `AnimatePresence initial={false}`, so the dock snaps
// back in a single reflow rather than animating width frame by frame.
function ShellHost({ children }: { children: ReactNode }) {
  const { state, actions } = useShell()
  if (state.maximized) return null

  return (
    <RightPaneHost
      open={state.open}
      width={ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH}
      resizable
      minWidth={ARTIFACT_RIGHT_PANE_MIN_WIDTH}
      defaultWidth={ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH}
      maxWidth={ARTIFACT_RIGHT_PANE_MAX_WIDTH}
      cacheKey={ARTIFACT_RIGHT_PANE_CACHE_KEY}
      reservedCenterWidth={CHAT_CENTER_MIN_USABLE_WIDTH}
      onReservedSpaceUnavailable={actions.close}
      onOpenAnimationComplete={actions.refreshPdfLayout}
      onCloseAnimationComplete={actions.finishClose}>
      {children}
    </RightPaneHost>
  )
}

// Maximized surface. Reveals via a right-anchored clip-path wipe: the pane grows
// leftward while its right edge (and the controls docked there) stay put. The
// content is laid out once at full width; clip-path is paint-only, so there is
// no per-frame layout/reflow. ease-out-expo; exit is quicker than enter.
const MAXIMIZE_ENTER = { duration: 0.24, ease: [0.16, 1, 0.3, 1] } as const
const MAXIMIZE_EXIT = { duration: 0.18, ease: [0.16, 1, 0.3, 1] } as const
const CLIP_COLLAPSED = 'inset(0% 0% 0% 100%)'
const CLIP_REVEALED = 'inset(0% 0% 0% 0%)'

function ShellMaximizedOverlay({ children }: { children: ReactNode }) {
  const { state, actions } = useShell()
  const reduceMotion = useReducedMotion()
  const bottomInset = useChatMaximizedOverlayBottomInset()

  return (
    <AnimatePresence onExitComplete={actions.finishClose}>
      {state.open && state.maximized && (
        <motion.div
          data-shell-maximized-overlay=""
          key="shell-maximized"
          initial={{ clipPath: CLIP_COLLAPSED }}
          animate={{ clipPath: CLIP_REVEALED }}
          exit={{ clipPath: CLIP_COLLAPSED, transition: reduceMotion ? { duration: 0 } : MAXIMIZE_EXIT }}
          transition={reduceMotion ? { duration: 0 } : MAXIMIZE_ENTER}
          className="absolute inset-0 z-40 overflow-hidden bg-background">
          <div
            data-shell-maximized-overlay-content=""
            className="h-full min-h-0 overflow-hidden"
            style={bottomInset > 0 ? { height: `max(0px, calc(100% - ${bottomInset}px))` } : undefined}>
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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
  const toggleLabel = t(pressed ? 'common.close_sidebar' : 'common.open_sidebar')
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

function ShellTabs({ children }: { children: ReactNode }) {
  const { state, actions } = useShell()
  return (
    <Tabs
      value={state.activeTab}
      onValueChange={actions.openTab}
      variant="line"
      className="h-full gap-0 overflow-hidden bg-card text-card-foreground">
      {children}
    </Tabs>
  )
}

// Header bar: the tab strip plus the pane-level maximize toggle.
// `extraTrailing` hosts the navbar-right cluster (sub-window controls, pane toggle) when the
// pane is open — see ConversationShellTopRightTool, which suppresses itself in that state so
// the cluster doesn't sit on top of this header.
function ShellTabList({ children, extraTrailing }: { children: ReactNode; extraTrailing?: ReactNode }) {
  const { state, actions } = useShell()
  const { t } = useTranslation()
  const { mode } = useWindowFrame()
  const maximizeLabel = t(state.maximized ? 'common.minimize' : 'common.maximize')
  const MaximizeIcon = state.maximized ? Minimize2 : Maximize2
  // When the pane is maximized inside a sub-window, this header becomes the window's top edge
  // — clear the macOS traffic lights and let the user drag the window from the tab strip,
  // matching ConversationShellTopBar.
  const isWindowTopBar = state.maximized && mode === 'window'
  return (
    <div
      data-testid="shell-tab-list"
      className={cn(
        'flex h-(--navbar-height) shrink-0 items-center justify-between gap-2 border-border-subtle border-b pr-3',
        isWindowTopBar ? '[-webkit-app-region:drag]' : '[-webkit-app-region:no-drag]',
        isWindowTopBar && isMac ? 'pl-[env(titlebar-area-x)]' : 'pl-3'
      )}>
      <HorizontalScrollContainer className="min-w-0 flex-1" gap="4px" scrollDistance={180}>
        <TabsList className="min-w-max justify-start gap-1 [-webkit-app-region:no-drag]">{children}</TabsList>
      </HorizontalScrollContainer>
      <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
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
        {extraTrailing}
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
// so it is used as `<Shell>` / `<Shell.Host>` rather than `<Shell.Provider>`.
export const Shell = Object.assign(ShellProvider, {
  Host: ShellHost,
  MaximizedOverlay: ShellMaximizedOverlay,
  Toggle: ShellToggle,
  Tabs: ShellTabs,
  TabList: ShellTabList,
  Tab: ShellTab,
  Panel: ShellPanel
})
