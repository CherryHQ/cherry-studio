import { Tooltip } from '@cherrystudio/ui'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { RightSidebarCollapseIcon } from '@renderer/components/icons/SidebarToggleIcons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { cn } from '@renderer/utils/style'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { ComponentProps, ComponentType, MouseEvent, ReactNode } from 'react'
import { Activity, createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ARTIFACT_RIGHT_PANE_CACHE_KEY,
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  CHAT_CENTER_MIN_USABLE_WIDTH
} from '../../shell/paneLayout'
import { PersistentRightPaneHost, type RightPaneLayoutMode } from '../../shell/RightPaneHost'

export type RightPanelReadiness = 'ready' | 'pending' | 'unavailable'

export interface RightPanelComponentProps<TScope> {
  /** Effective presentation state for this concrete instance. */
  active: boolean
  panelId: string
  scope: TScope
}

export interface RightPanelInstance {
  id: string
  /** Stable semantic identity. A change intentionally starts a fresh component instance. */
  instanceKey: string
  title: ReactNode
  readiness: RightPanelReadiness
  /** Whether this panel may enter maximized presentation. */
  canMaximize?: boolean
}

/** Resolves one panel slot from domain-owned scope; null means the slot has no identity. */
export interface RightPanelCapability<TScope> {
  component: ComponentType<RightPanelComponentProps<TScope>>
  resolve: (scope: TScope) => RightPanelInstance | null
}

interface ResolvedRightPanelEntry<TScope = unknown> extends RightPanelInstance {
  component: ComponentType<RightPanelComponentProps<TScope>>
}

export interface RightPanelState {
  /** The ready panel selected for presentation; visibility is reported separately. */
  activePanelId?: string
  /** First ready entry, then first pending entry, then the first catalog entry. */
  defaultPanelId?: string
  /** Raw maximize intent, retained while environmental presentation is disabled. */
  maximized: boolean
  /** True only when the panel is open and a ready entry is being presented. */
  presentationOpen: boolean
  /** Maximized layout is effective only while a ready panel is presented. */
  presentationMaximized: boolean
  /** Whether the current page environment allows a panel to be presented. */
  presentationEnabled: boolean
  /** True while maximize/minimize layout is moving to its settled mode. */
  layoutAnimationPending: boolean
  pdfLayoutPending: boolean
  pdfLayoutRefreshKey: number
  isActive: (panelId: string) => boolean
}

export interface RightPanelActions {
  canOpen: (panelId: string) => boolean
  /** Opens a currently ready panel and returns whether the request was accepted. */
  tryOpen: (panelId: string) => boolean
  /** Records selection intent for a dynamic entry created in the same React batch. */
  requestOpen: (panelId: string) => void
  close: () => void
  minimize: () => void
}

interface RightPanelControllerActions extends RightPanelActions {
  completeLayoutAnimation: (mode: RightPaneLayoutMode) => void
  toggleMaximized: () => void
}

interface RightPanelRenderContextValue {
  entries: readonly ResolvedRightPanelEntry[]
  mountedInstances: ReadonlyMap<string, string>
  scope: unknown
}

const RightPanelRenderContext = createContext<RightPanelRenderContextValue | null>(null)
const RightPanelStateContext = createContext<RightPanelState | null>(null)
const RightPanelActionsContext = createContext<RightPanelControllerActions | null>(null)

function resolveRightPanelEntries<TScope>(
  capabilities: readonly RightPanelCapability<TScope>[],
  scope: TScope
): readonly ResolvedRightPanelEntry[] {
  const entries: ResolvedRightPanelEntry[] = []
  const panelIds = new Set<string>()

  for (const capability of capabilities) {
    const instance = capability.resolve(scope)
    if (!instance) continue
    if (panelIds.has(instance.id)) throw new Error(`Duplicate right-panel id: ${instance.id}`)
    panelIds.add(instance.id)
    entries.push({
      ...instance,
      component: capability.component as ComponentType<RightPanelComponentProps<unknown>>
    })
  }

  return entries
}

function findEntry(entries: readonly ResolvedRightPanelEntry[], panelId?: string): ResolvedRightPanelEntry | undefined {
  return panelId ? entries.find((entry) => entry.id === panelId) : undefined
}

function getDefaultEntry(entries: readonly ResolvedRightPanelEntry[]): ResolvedRightPanelEntry | undefined {
  return (
    entries.find((entry) => entry.readiness === 'ready') ??
    entries.find((entry) => entry.readiness === 'pending') ??
    entries[0]
  )
}

function updateMountedInstances(
  current: ReadonlyMap<string, string>,
  entries: readonly ResolvedRightPanelEntry[],
  activeEntry: ResolvedRightPanelEntry | undefined,
  presentationOpen: boolean
): ReadonlyMap<string, string> {
  const currentEntries = new Map(entries.map((entry) => [entry.id, entry]))
  const next = new Map<string, string>()
  let changed = false

  for (const [panelId, instanceKey] of current) {
    const entry = currentEntries.get(panelId)
    if (entry && entry.instanceKey === instanceKey && entry.readiness !== 'unavailable') {
      next.set(panelId, instanceKey)
    } else {
      changed = true
    }
  }

  if (presentationOpen && activeEntry && next.get(activeEntry.id) !== activeEntry.instanceKey) {
    next.set(activeEntry.id, activeEntry.instanceKey)
    changed = true
  }

  return changed ? next : current
}

export function RightPanelProvider<TScope>({
  capabilities,
  children,
  defaultOpen = false,
  defaultPanelId,
  onOpenChange,
  present = true,
  scope
}: {
  capabilities: readonly RightPanelCapability<TScope>[]
  children: ReactNode
  defaultOpen?: boolean
  defaultPanelId?: string
  onOpenChange?: (open: boolean) => void
  /** Environmental visibility; false hides presentation while preserving intent and visited instances. */
  present?: boolean
  scope: TScope
}) {
  const entries = useMemo(() => resolveRightPanelEntries(capabilities, scope), [capabilities, scope])
  const [open, setOpen] = useState(defaultOpen)
  const [maximized, setMaximized] = useState(false)
  const [requestedPanelId, setRequestedPanelId] = useState(defaultPanelId)
  const [layoutAnimationPending, setLayoutAnimationPending] = useState(false)
  const [pdfLayoutPending, setPdfLayoutPending] = useState(false)
  const [pdfLayoutRefreshKey, setPdfLayoutRefreshKey] = useState(0)
  const [mountedInstances, setMountedInstances] = useState<ReadonlyMap<string, string>>(() => new Map())
  const openRef = useRef(open)
  const previousDefaultOpenRef = useRef(defaultOpen)
  const onOpenChangeRef = useRef(onOpenChange)

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (previousDefaultOpenRef.current === defaultOpen) return
    previousDefaultOpenRef.current = defaultOpen
    if (openRef.current === defaultOpen) return

    openRef.current = defaultOpen
    setOpen(defaultOpen)
    if (defaultOpen) {
      setRequestedPanelId(defaultPanelId)
      setPdfLayoutPending(true)
    } else {
      setMaximized(false)
      setLayoutAnimationPending(false)
      setPdfLayoutPending(false)
    }
  }, [defaultOpen, defaultPanelId])

  const requestedEntry = findEntry(entries, requestedPanelId)
  const defaultEntry = getDefaultEntry(entries)
  const fallbackEntry = entries.find((entry) => entry.readiness === 'ready')
  const activeEntry =
    requestedEntry?.readiness === 'ready'
      ? requestedEntry
      : requestedEntry?.readiness === 'pending'
        ? undefined
        : fallbackEntry
  const pendingEntry =
    requestedEntry?.readiness === 'pending'
      ? requestedEntry
      : !activeEntry && defaultEntry?.readiness === 'pending'
        ? defaultEntry
        : undefined
  const reconciledEntry = activeEntry ?? pendingEntry
  const presentationOpen = present && open && Boolean(activeEntry)
  const presentationMaximized = presentationOpen && maximized

  useLayoutEffect(() => {
    if (!reconciledEntry || reconciledEntry.id === requestedPanelId) return
    setRequestedPanelId(reconciledEntry.id)
  }, [reconciledEntry, requestedPanelId])

  useLayoutEffect(() => {
    setMountedInstances((current) => updateMountedInstances(current, entries, activeEntry, presentationOpen))
  }, [activeEntry, entries, presentationOpen])

  const isActive = useCallback(
    (panelId: string) => presentationOpen && activeEntry?.id === panelId,
    [activeEntry?.id, presentationOpen]
  )
  const canOpen = useCallback((panelId: string) => findEntry(entries, panelId)?.readiness === 'ready', [entries])
  const requestOpen = useCallback((panelId: string) => {
    const wasOpen = openRef.current
    openRef.current = true
    setRequestedPanelId(panelId)
    setOpen(true)
    if (!wasOpen) setPdfLayoutPending(true)
    onOpenChangeRef.current?.(true)
  }, [])
  const tryOpen = useCallback(
    (panelId: string) => {
      if (!canOpen(panelId)) return false
      requestOpen(panelId)
      return true
    },
    [canOpen, requestOpen]
  )
  const close = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    setOpen(false)
    setMaximized(false)
    setPdfLayoutPending(false)
    onOpenChangeRef.current?.(false)
  }, [])
  const minimize = useCallback(() => {
    setLayoutAnimationPending(true)
    setPdfLayoutPending(false)
    setMaximized(false)
  }, [])
  const toggleMaximized = useCallback(() => {
    setLayoutAnimationPending(true)
    setPdfLayoutPending(false)
    setMaximized((current) => !current)
  }, [])
  const completeLayoutAnimation = useCallback((mode: RightPaneLayoutMode) => {
    setLayoutAnimationPending(false)
    if (mode === 'closed') return
    setPdfLayoutPending(false)
    setPdfLayoutRefreshKey((key) => key + 1)
  }, [])

  const state = useMemo<RightPanelState>(
    () => ({
      activePanelId: activeEntry?.id,
      defaultPanelId: defaultEntry?.id,
      maximized,
      presentationOpen,
      presentationMaximized,
      presentationEnabled: present,
      layoutAnimationPending,
      pdfLayoutPending,
      pdfLayoutRefreshKey,
      isActive
    }),
    [
      activeEntry?.id,
      defaultEntry?.id,
      isActive,
      layoutAnimationPending,
      maximized,
      pdfLayoutPending,
      pdfLayoutRefreshKey,
      present,
      presentationMaximized,
      presentationOpen
    ]
  )
  const actions = useMemo<RightPanelControllerActions>(
    () => ({
      canOpen,
      tryOpen,
      requestOpen,
      close,
      minimize,
      completeLayoutAnimation,
      toggleMaximized
    }),
    [canOpen, close, completeLayoutAnimation, minimize, requestOpen, toggleMaximized, tryOpen]
  )
  const renderValue = useMemo<RightPanelRenderContextValue>(
    () => ({ entries, mountedInstances, scope }),
    [entries, mountedInstances, scope]
  )

  return (
    <RightPanelActionsContext value={actions}>
      <RightPanelStateContext value={state}>
        <RightPanelRenderContext value={renderValue}>{children}</RightPanelRenderContext>
      </RightPanelStateContext>
    </RightPanelActionsContext>
  )
}

export function useRightPanelState(): RightPanelState {
  const state = use(RightPanelStateContext)
  if (!state) throw new Error('useRightPanelState must be used within <RightPanelProvider>')
  return state
}

export function useOptionalRightPanelState(): RightPanelState | undefined {
  return use(RightPanelStateContext) ?? undefined
}

function useRightPanelControllerActions(): RightPanelControllerActions {
  const actions = use(RightPanelActionsContext)
  if (!actions) throw new Error('useRightPanelActions must be used within <RightPanelProvider>')
  return actions
}

export function useRightPanelActions(): RightPanelActions {
  return useRightPanelControllerActions()
}

export function useOptionalRightPanelActions(): RightPanelActions | undefined {
  return use(RightPanelActionsContext) ?? undefined
}

function RightPanelHeader({ canMaximize = false, title }: { canMaximize?: boolean; title?: ReactNode }) {
  const state = useRightPanelState()
  const actions = useRightPanelControllerActions()
  const { t } = useTranslation()
  const maximizeLabel = t(state.presentationMaximized ? 'common.minimize' : 'common.maximize')
  const MaximizeIcon = state.presentationMaximized ? Minimize2 : Maximize2
  const closeLabel = t('common.close_sidebar')

  const maximizeButton =
    canMaximize || state.presentationMaximized ? (
      <Tooltip content={maximizeLabel} delay={800}>
        <NavbarIcon
          tone="conversation"
          className="[&_svg]:!size-3.5 shrink-0"
          aria-label={maximizeLabel}
          aria-pressed={state.presentationMaximized}
          onClick={actions.toggleMaximized}>
          <MaximizeIcon />
        </NavbarIcon>
      </Tooltip>
    ) : null

  return (
    <div
      data-testid="shell-tab-list"
      className={cn(
        'flex h-(--navbar-height) shrink-0 items-center justify-between gap-2 border-border-subtle border-b px-2 [-webkit-app-region:no-drag]',
        state.presentationMaximized && 'bg-card'
      )}>
      <div
        data-testid="shell-tab-title"
        className="min-w-0 flex-1 select-none truncate px-1 font-medium text-foreground text-sm">
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
        {maximizeButton}
        <Tooltip content={closeLabel} delay={800}>
          <NavbarIcon tone="conversation" aria-label={closeLabel} onClick={actions.close}>
            <RightSidebarCollapseIcon />
          </NavbarIcon>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * Renders every panel that has been presented once. Activity preserves hidden
 * panel state and DOM while pausing its effects; unavailable or identity-replaced
 * instances are removed.
 */
export function RightPanel() {
  const context = use(RightPanelRenderContext)
  if (!context) throw new Error('RightPanel must be used within <RightPanelProvider>')
  const state = useRightPanelState()
  const mountedEntries = context.entries.filter(
    (entry) => context.mountedInstances.get(entry.id) === entry.instanceKey && entry.readiness !== 'unavailable'
  )
  const activeEntry = findEntry(context.entries, state.activePanelId)

  return (
    <div className="flex h-full flex-col gap-0 overflow-hidden text-card-foreground">
      <RightPanelHeader canMaximize={activeEntry?.canMaximize} title={activeEntry?.title} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {mountedEntries.map((entry) => {
          const Panel = entry.component
          const active = state.isActive(entry.id)
          return (
            <Activity key={`${entry.id}:${entry.instanceKey}`} mode={active ? 'visible' : 'hidden'}>
              <div className="h-full min-h-0 overflow-hidden">
                <ErrorBoundary>
                  <Panel active={active} panelId={entry.id} scope={context.scope} />
                </ErrorBoundary>
              </div>
            </Activity>
          )
        })}
      </div>
    </div>
  )
}

function RightPanelKeyboardShortcut() {
  const state = useRightPanelState()
  const actions = useRightPanelActions()
  const isActiveTab = useIsActiveTab()
  const targetPanelId = state.defaultPanelId
  const enabled = state.presentationEnabled && isActiveTab && Boolean(targetPanelId && actions.canOpen(targetPanelId))
  const handleToggle = useCallback(() => {
    if (state.presentationOpen) {
      actions.close()
    } else if (targetPanelId) {
      actions.tryOpen(targetPanelId)
    }
  }, [actions, state.presentationOpen, targetPanelId])

  useCommandHandler('topic.sidebar.toggle', handleToggle, { enabled })
  return null
}

export function RightPanelViewport({ children }: { children: ReactNode }) {
  const state = useRightPanelState()
  const actions = useRightPanelControllerActions()

  return (
    <>
      <RightPanelKeyboardShortcut />
      <PersistentRightPaneHost
        open={state.presentationOpen}
        maximized={state.presentationMaximized}
        width={ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH}
        resizable
        minWidth={ARTIFACT_RIGHT_PANE_MIN_WIDTH}
        defaultWidth={ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH}
        maxWidth={ARTIFACT_RIGHT_PANE_MAX_WIDTH}
        cacheKey={ARTIFACT_RIGHT_PANE_CACHE_KEY}
        reservedCenterWidth={CHAT_CENTER_MIN_USABLE_WIDTH}
        onLayoutAnimationComplete={actions.completeLayoutAnimation}>
        {children}
      </PersistentRightPaneHost>
    </>
  )
}

export function RightPanelShortcut({
  tab,
  label,
  icon,
  disabled = false,
  tooltip,
  className,
  onClick,
  ...buttonProps
}: Omit<ComponentProps<typeof NavbarIcon>, 'active' | 'aria-label' | 'children' | 'onClick' | 'tone'> & {
  tab: string
  label: string
  icon: ReactNode
  tooltip?: ReactNode | false
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const state = useRightPanelState()
  const actions = useRightPanelActions()
  const ready = actions.canOpen(tab)
  const active = state.isActive(tab)
  const tooltipContent = tooltip === false ? false : (tooltip ?? label)
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      if (active) {
        actions.close()
        return
      }
      actions.tryOpen(tab)
    },
    [actions, active, onClick, tab]
  )

  if (!ready || state.presentationMaximized) return null

  const button = (
    <NavbarIcon
      {...buttonProps}
      tone="conversation"
      className={cn('[&_svg]:!size-3.5 shrink-0', className)}
      active={active}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
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
