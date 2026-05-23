import { Button, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import {
  ARTIFACT_RIGHT_PANE_CACHE_KEY,
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  RightPaneHost
} from '@renderer/components/chat'
import { RightSidebarCollapseIcon, RightSidebarExpandIcon } from '@renderer/components/Icons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { cn } from '@renderer/utils'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

// ── Generic tabbed side-pane shell ──────────────────────────────────────────
// Knows only about open/maximized/inset/activeTab. Tabs and their content are
// composed in by the consumer via <Shell.Tab> / <Shell.Panel>.

interface ShellState {
  open: boolean
  maximized: boolean
  activeTab: string
  pdfLayoutPending: boolean
  pdfLayoutRefreshKey: number
}

interface ShellActions {
  openTab: (tab: string) => void
  toggleTab: (tab: string) => void
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

function ShellProvider({ children, defaultTab }: { children: ReactNode; defaultTab: string }) {
  const [open, setOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [pdfLayoutPending, setPdfLayoutPending] = useState(false)
  const [pdfLayoutRefreshKey, setPdfLayoutRefreshKey] = useState(0)

  const openTab = useCallback((tab: string) => {
    setActiveTab(tab)
    setOpen((currentOpen) => {
      if (!currentOpen) setPdfLayoutPending(true)
      return true
    })
  }, [])
  const toggleTab = useCallback(
    (tab: string) => {
      setOpen((currentOpen) => {
        if (currentOpen && activeTab === tab) {
          setMaximized(false)
          setPdfLayoutPending(false)
          return false
        }
        setActiveTab(tab)
        if (!currentOpen) setPdfLayoutPending(true)
        return true
      })
    },
    [activeTab]
  )
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
      actions: { openTab, toggleTab, toggleMaximized, refreshPdfLayout }
    }),
    [
      activeTab,
      maximized,
      open,
      openTab,
      pdfLayoutPending,
      pdfLayoutRefreshKey,
      refreshPdfLayout,
      toggleMaximized,
      toggleTab
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
      onOpenAnimationComplete={actions.refreshPdfLayout}>
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
  const { state } = useShell()
  const reduceMotion = useReducedMotion()

  return (
    <AnimatePresence>
      {state.open && state.maximized && (
        <motion.div
          key="shell-maximized"
          initial={{ clipPath: CLIP_COLLAPSED }}
          animate={{ clipPath: CLIP_REVEALED }}
          exit={{ clipPath: CLIP_COLLAPSED, transition: reduceMotion ? { duration: 0 } : MAXIMIZE_EXIT }}
          transition={reduceMotion ? { duration: 0 } : MAXIMIZE_ENTER}
          className="absolute inset-0 z-40 overflow-hidden bg-background">
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Navbar button that opens the pane to a given tab (or collapses it).
function ShellToggle({ tab, label }: { tab: string; label: string }) {
  const { state, actions } = useShell()
  const pressed = state.open && state.activeTab === tab

  return (
    <Tooltip content={label} delay={800}>
      <NavbarIcon
        onClick={() => actions.toggleTab(tab)}
        aria-pressed={pressed}
        aria-label={label}
        data-state={pressed ? 'open' : 'closed'}>
        {pressed ? <RightSidebarCollapseIcon /> : <RightSidebarExpandIcon />}
      </NavbarIcon>
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
function ShellTabList({ children }: { children: ReactNode }) {
  const { state, actions } = useShell()
  const { t } = useTranslation()
  const maximizeLabel = t(state.maximized ? 'common.minimize' : 'common.maximize')
  const MaximizeIcon = state.maximized ? Minimize2 : Maximize2
  return (
    <div className="flex h-(--navbar-height) shrink-0 items-center justify-between gap-2 border-border-subtle border-b px-3">
      <TabsList className="min-w-0 flex-1 justify-start gap-1 overflow-x-auto">{children}</TabsList>
      <Tooltip content={maximizeLabel} delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={maximizeLabel}
          aria-pressed={state.maximized}
          onClick={actions.toggleMaximized}>
          <MaximizeIcon size={15} />
        </Button>
      </Tooltip>
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
        className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-all duration-150 hover:bg-foreground/10 hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <X size={11} />
      </div>
    </div>
  )
}

function ShellPanel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  return (
    <TabsContent value={value} className={cn('min-h-0 overflow-hidden', className)}>
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
