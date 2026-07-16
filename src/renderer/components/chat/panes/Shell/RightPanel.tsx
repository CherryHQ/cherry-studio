import { Tooltip } from '@cherrystudio/ui'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { cn } from '@renderer/utils/style'
import type { ComponentProps, ComponentType, MouseEvent, ReactNode } from 'react'
import { Activity, createContext, use, useCallback, useLayoutEffect, useMemo, useState } from 'react'

import { Shell, type ShellTabShortcutOpenBehavior, useShellActions, useShellState } from './Shell'

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
}

/**
 * A stable, module-level declaration for one panel slot. It resolves at most one
 * concrete instance from domain-owned scope; null means the slot has no identity.
 */
export interface RightPanelCapability<TScope> {
  component: ComponentType<RightPanelComponentProps<TScope>>
  resolve: (scope: TScope) => RightPanelInstance | null
  className?: string
}

interface ResolvedRightPanelEntry<TScope = unknown> extends RightPanelInstance {
  component: ComponentType<RightPanelComponentProps<TScope>>
  className?: string
}

export interface RightPanelState {
  /** The ready panel selected for presentation; visibility is reported separately. */
  activePanelId?: string
  /** First ready entry, then first pending entry, then the first catalog entry. */
  defaultPanelId?: string
  /** True only when the shell is open and a ready panel is being presented. */
  presentationOpen: boolean
  /** Maximized layout is effective only while a ready panel is presented. */
  presentationMaximized: boolean
  /** Whether the current page environment allows a panel to be presented. */
  presentationEnabled: boolean
  isActive: (panelId: string) => boolean
}

export interface RightPanelActions {
  canOpen: (panelId: string) => boolean
  /** Opens a currently ready panel and returns whether the request was accepted. */
  tryOpen: (panelId: string) => boolean
  /**
   * Records raw selection intent. Domain owners use this only for compound
   * transitions that create a dynamic instance and select it in one batch.
   */
  requestOpen: (panelId: string) => void
  close: (afterClose?: () => void) => void
}

interface RightPanelRenderContextValue {
  entries: readonly ResolvedRightPanelEntry[]
  mountedInstances: ReadonlyMap<string, string>
  scope: unknown
}

const RightPanelRenderContext = createContext<RightPanelRenderContextValue | null>(null)
const RightPanelStateContext = createContext<RightPanelState | null>(null)
const RightPanelActionsContext = createContext<RightPanelActions | null>(null)

export function defineRightPanelCapabilities<TScope>() {
  return <TCapabilities extends readonly RightPanelCapability<TScope>[]>(capabilities: TCapabilities) => capabilities
}

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
      className: capability.className,
      component: capability.component as ComponentType<RightPanelComponentProps<unknown>>
    })
  }

  return entries
}

function findEntry(entries: readonly ResolvedRightPanelEntry[], panelId: string): ResolvedRightPanelEntry | undefined {
  return entries.find((entry) => entry.id === panelId)
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
  present = true,
  scope
}: {
  capabilities: readonly RightPanelCapability<TScope>[]
  children: ReactNode
  /** Environmental visibility; false hides presentation while preserving shell intent and visited instances. */
  present?: boolean
  scope: TScope
}) {
  const shellState = useShellState()
  const shellActions = useShellActions()
  const entries = useMemo(() => resolveRightPanelEntries(capabilities, scope), [capabilities, scope])
  const requestedEntry = findEntry(entries, shellState.activeTab)
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
  const presentationOpen = present && shellState.open && Boolean(activeEntry)
  const presentationMaximized = presentationOpen && shellState.maximized
  const [mountedInstances, setMountedInstances] = useState<ReadonlyMap<string, string>>(() => new Map())

  useLayoutEffect(() => {
    if (!reconciledEntry || reconciledEntry.id === shellState.activeTab) return
    shellActions.reconcileTab(reconciledEntry.id)
  }, [reconciledEntry, shellActions, shellState.activeTab])

  useLayoutEffect(() => {
    setMountedInstances((current) => updateMountedInstances(current, entries, activeEntry, presentationOpen))
  }, [activeEntry, entries, presentationOpen])

  const isActive = useCallback(
    (panelId: string) => presentationOpen && activeEntry?.id === panelId,
    [activeEntry?.id, presentationOpen]
  )
  const state = useMemo<RightPanelState>(
    () => ({
      activePanelId: activeEntry?.id,
      defaultPanelId: defaultEntry?.id,
      presentationOpen,
      presentationMaximized,
      presentationEnabled: present,
      isActive
    }),
    [activeEntry?.id, defaultEntry?.id, isActive, present, presentationMaximized, presentationOpen]
  )
  const canOpen = useCallback((panelId: string) => findEntry(entries, panelId)?.readiness === 'ready', [entries])
  const requestOpen = useCallback((panelId: string) => shellActions.openTab(panelId), [shellActions])
  const tryOpen = useCallback(
    (panelId: string) => {
      if (!canOpen(panelId)) return false
      requestOpen(panelId)
      return true
    },
    [canOpen, requestOpen]
  )
  const actions = useMemo<RightPanelActions>(
    () => ({
      canOpen,
      tryOpen,
      requestOpen,
      close: shellActions.close
    }),
    [canOpen, requestOpen, shellActions.close, tryOpen]
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

export function useRightPanelActions(): RightPanelActions {
  const actions = use(RightPanelActionsContext)
  if (!actions) throw new Error('useRightPanelActions must be used within <RightPanelProvider>')
  return actions
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
  const activeEntry = state.activePanelId ? findEntry(context.entries, state.activePanelId) : undefined

  return (
    <Shell.Tabs value={state.activePanelId ?? ''}>
      <Shell.TabList title={activeEntry?.title} showTabs={false} />
      {mountedEntries.map((entry) => {
        const Panel = entry.component
        const active = state.isActive(entry.id)
        return (
          <Shell.Panel key={`${entry.id}:${entry.instanceKey}`} value={entry.id} className={entry.className} forceMount>
            <Activity mode={active ? 'visible' : 'hidden'}>
              <ErrorBoundary>
                <Panel active={active} panelId={entry.id} scope={context.scope} />
              </ErrorBoundary>
            </Activity>
          </Shell.Panel>
        )
      })}
    </Shell.Tabs>
  )
}

export function RightPanelShortcut({
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
  const state = useRightPanelState()
  const actions = useRightPanelActions()
  const ready = actions.canOpen(tab)
  const active = state.isActive(tab)
  const togglesActive = openBehavior === 'toggle-active'
  const tooltipContent = tooltip === false ? false : (tooltip ?? label)
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      if (togglesActive && active) {
        actions.close()
        return
      }
      actions.tryOpen(tab)
    },
    [actions, active, onClick, tab, togglesActive]
  )

  if (!ready || state.presentationMaximized || (state.presentationOpen && openBehavior === 'hide')) return null

  const button = (
    <NavbarIcon
      {...buttonProps}
      tone="conversation"
      className={cn('[&_svg]:!size-3.5 shrink-0', className)}
      active={active}
      disabled={disabled}
      aria-label={label}
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
