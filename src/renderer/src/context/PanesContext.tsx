import { loggerService } from '@logger'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { PaneLRUManager } from '@renderer/services/PaneLRUManager'
import { uuid } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type {
  LeafPane,
  PaneDirection,
  PaneLayout,
  PanesState,
  PaneTab,
  TabSavedState,
  TabType
} from '@shared/data/cache/cacheValueTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useRef } from 'react'

import {
  collectAllLeafIds,
  findLeafById,
  findTabInTree,
  firstLeaf,
  removeLeafById,
  splitLeaf,
  updateLeafById,
  updateRatioAtPath
} from '../utils/paneTree'

const logger = loggerService.withContext('PanesContext')

const ROOT_PANE_ID = 'pane-root'
const HOME_TAB_ID = 'home'

function makeHomeTab(): PaneTab {
  return {
    id: HOME_TAB_ID,
    type: 'route',
    url: '/home',
    title: '',
    lastAccessTime: Date.now(),
    isDormant: false
  }
}

function makeDefaultPanesState(): PanesState {
  return {
    root: {
      type: 'leaf',
      paneId: ROOT_PANE_ID,
      tabs: [makeHomeTab()],
      activeTabId: HOME_TAB_ID
    },
    activePaneId: ROOT_PANE_ID
  }
}

function withLocalizedTitle(tab: PaneTab): PaneTab {
  if (tab.type !== 'route') return tab
  return { ...tab, title: getDefaultRouteTitle(tab.url) }
}

/**
 * Enforce the three PanesState invariants:
 *   1. activePaneId references an existing leaf (else fall back to firstLeaf)
 *   2. every leaf's activeTabId references a tab in that leaf's tabs
 *   3. empty leaves auto-collapse; empty tree → DEFAULT_PANES_STATE
 */
function normalize(state: PanesState): PanesState {
  let root: PaneLayout | null = state.root

  // Auto-collapse empty leaves.
  const leafIds = collectAllLeafIds(root)
  for (const paneId of leafIds) {
    const leaf = findLeafById(root, paneId)
    if (leaf && leaf.tabs.length === 0) {
      root = removeLeafById(root, paneId)
      if (root === null) break
    }
  }

  if (root === null) {
    return makeDefaultPanesState()
  }

  // Snap each leaf's activeTabId into `tabs`.
  for (const paneId of collectAllLeafIds(root)) {
    const leaf = findLeafById(root, paneId)
    if (!leaf) continue
    const hasActive = leaf.tabs.some((t) => t.id === leaf.activeTabId)
    if (!hasActive && leaf.tabs.length > 0) {
      root = updateLeafById(root, paneId, (l) => ({ ...l, activeTabId: l.tabs[0].id }))
    }
  }

  // Snap activePaneId.
  let activePaneId = state.activePaneId
  if (!findLeafById(root, activePaneId)) {
    activePaneId = firstLeaf(root).paneId
  }

  return { root, activePaneId }
}

// ─── Context API ──────────────────────────────────────────────────────────────

export interface OpenTabOptions {
  forceNew?: boolean
  title?: string
  type?: TabType
  id?: string
}

export interface PanesContextValue {
  panes: PanesState
  activePaneId: string
  activePane: LeafPane
  activeTab: PaneTab | undefined
  isLoading: boolean

  // Navigation
  openTabInPane: (paneId: string, url: string, options?: OpenTabOptions) => string
  openTabInActivePane: (url: string, options?: OpenTabOptions) => string
  setActiveTab: (paneId: string, tabId: string) => void
  setActivePane: (paneId: string) => void
  closeTab: (paneId: string, tabId: string) => void
  updateTab: (paneId: string, tabId: string, updates: Partial<PaneTab>) => void

  // Pin
  pinTab: (paneId: string, tabId: string) => void
  unpinTab: (paneId: string, tabId: string) => void

  // Reorder within a pane
  reorderTabsInPane: (paneId: string, oldIndex: number, newIndex: number) => void

  // Split
  splitPane: (paneId: string, direction: PaneDirection, seedTab?: PaneTab) => void
  unsplitPane: (paneId: string) => void
  updateSplitRatio: (path: number[], ratio: number) => void

  // LRU
  hibernateTab: (paneId: string, tabId: string) => void
  wakeTab: (paneId: string, tabId: string) => void

  // Detach / attach (cross-window)
  detachTab: (paneId: string, tabId: string) => void
  attachTab: (tab: PaneTab) => void
}

const PanesContext = createContext<PanesContextValue | null>(null)

export interface PanesProviderProps {
  children: ReactNode
  /** Optional seed (used by the detached window to override persistence). */
  initialState?: PanesState
  /** When true, disable persistence (detached window). */
  ephemeral?: boolean
}

export function PanesProvider({ children, initialState, ephemeral = false }: PanesProviderProps) {
  const [persisted, setPersisted] = usePersistCache('ui.panes.layout')

  // In ephemeral mode, keep state purely in a ref-backed memory store to avoid
  // accidentally overwriting main-window persistence.
  const ephemeralRef = useRef<PanesState>(initialState ?? makeDefaultPanesState())

  const panes = ephemeral ? ephemeralRef.current : persisted

  // Ref mirror for functional updates (usePersistCache setter takes a direct value).
  const persistedRef = useRef(persisted)
  persistedRef.current = persisted

  const setPanes = useCallback(
    (updater: PanesState | ((prev: PanesState) => PanesState)) => {
      if (ephemeral) {
        const prev = ephemeralRef.current
        const next = typeof updater === 'function' ? (updater as (p: PanesState) => PanesState)(prev) : updater
        ephemeralRef.current = normalize(next)
        return
      }
      const prev = persistedRef.current
      const next = typeof updater === 'function' ? (updater as (p: PanesState) => PanesState)(prev) : updater
      const normalized = normalize(next)
      persistedRef.current = normalized
      setPersisted(normalized)
    },
    [ephemeral, setPersisted]
  )

  // Seed initial state for ephemeral windows only once on mount.
  useEffect(() => {
    if (ephemeral && initialState) {
      ephemeralRef.current = normalize(initialState)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // LRU manager (singleton)
  const lruManagerRef = useRef<PaneLRUManager | null>(null)
  if (!lruManagerRef.current) {
    lruManagerRef.current = new PaneLRUManager()
  }

  const runLRU = useCallback((state: PanesState): PanesState => {
    const manager = lruManagerRef.current
    if (!manager) return state
    const toHibernate = manager.checkAndGetDormantCandidates(state.root, state.activePaneId)
    if (toHibernate.length === 0) return state

    let root = state.root
    for (const { paneId, tabId } of toHibernate) {
      root = updateLeafById(root, paneId, (leaf) => ({
        ...leaf,
        tabs: leaf.tabs.map((t) => {
          if (t.id !== tabId) return t
          const savedState: TabSavedState = { scrollPosition: 0 }
          logger.info('Tab auto-hibernated (LRU)', { paneId, tabId, route: t.url })
          return { ...t, isDormant: true, savedState }
        })
      }))
    }
    return { ...state, root }
  }, [])

  // ─── Derived ────────────────────────────────────────────────────────────────

  const activePaneId = panes.activePaneId
  const activePane = useMemo<LeafPane>(() => {
    return findLeafById(panes.root, activePaneId) ?? firstLeaf(panes.root)
  }, [panes.root, activePaneId])

  const activeTab = useMemo<PaneTab | undefined>(() => {
    const tab = activePane.tabs.find((t) => t.id === activePane.activeTabId)
    return tab ? withLocalizedTitle(tab) : undefined
  }, [activePane])

  // Localize titles on render (route-type tabs only).
  const panesView = useMemo<PanesState>(() => {
    const localize = (layout: PaneLayout): PaneLayout => {
      if (layout.type === 'leaf') {
        return { ...layout, tabs: layout.tabs.map(withLocalizedTitle) }
      }
      return { ...layout, children: [localize(layout.children[0]), localize(layout.children[1])] }
    }
    return { ...panes, root: localize(panes.root) }
  }, [panes])

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const setActivePane = useCallback(
    (paneId: string) => {
      setPanes((prev) => {
        if (!findLeafById(prev.root, paneId)) return prev
        if (prev.activePaneId === paneId) return prev
        return { ...prev, activePaneId: paneId }
      })
    },
    [setPanes]
  )

  const setActiveTab = useCallback(
    (paneId: string, tabId: string) => {
      setPanes((prev) => {
        const leaf = findLeafById(prev.root, paneId)
        if (!leaf) return prev
        if (!leaf.tabs.some((t) => t.id === tabId)) return prev

        const nextRoot = updateLeafById(prev.root, paneId, (l) => ({
          ...l,
          activeTabId: tabId,
          tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, lastAccessTime: Date.now(), isDormant: false } : t))
        }))
        const nextState = { root: nextRoot, activePaneId: paneId }
        return runLRU(nextState)
      })
    },
    [setPanes, runLRU]
  )

  const updateTab = useCallback(
    (paneId: string, tabId: string, updates: Partial<PaneTab>) => {
      setPanes((prev) => {
        const leaf = findLeafById(prev.root, paneId)
        if (!leaf) return prev
        if (!leaf.tabs.some((t) => t.id === tabId)) return prev
        const nextRoot = updateLeafById(prev.root, paneId, (l) => ({
          ...l,
          tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t))
        }))
        return { ...prev, root: nextRoot }
      })
    },
    [setPanes]
  )

  const addTabToPane = useCallback(
    (paneId: string, tab: PaneTab): void => {
      setPanes((prev) => {
        const leaf = findLeafById(prev.root, paneId)
        if (!leaf) return prev
        const exists = leaf.tabs.find((t) => t.id === tab.id)
        if (exists) {
          // Activate the existing tab instead of adding a duplicate.
          const nextRoot = updateLeafById(prev.root, paneId, (l) => ({
            ...l,
            activeTabId: tab.id,
            tabs: l.tabs.map((t) => (t.id === tab.id ? { ...t, lastAccessTime: Date.now(), isDormant: false } : t))
          }))
          return runLRU({ root: nextRoot, activePaneId: paneId })
        }
        const nextRoot = updateLeafById(prev.root, paneId, (l) => ({
          ...l,
          tabs: [...l.tabs, { ...tab, lastAccessTime: Date.now(), isDormant: false }],
          activeTabId: tab.id
        }))
        return runLRU({ root: nextRoot, activePaneId: paneId })
      })
    },
    [setPanes, runLRU]
  )

  const openTabInPane = useCallback(
    (paneId: string, url: string, options: OpenTabOptions = {}): string => {
      const { forceNew = false, title, type = 'route', id } = options
      const leaf = findLeafById(panes.root, paneId)
      if (!leaf) {
        logger.warn('openTabInPane: leaf not found', { paneId })
        return ''
      }

      if (!forceNew) {
        const existing = leaf.tabs.find((t) => t.type === type && t.url === url)
        if (existing) {
          setActiveTab(paneId, existing.id)
          return existing.id
        }
      }

      const newTab: PaneTab = {
        id: id || uuid(),
        type,
        url,
        title: title || getDefaultRouteTitle(url),
        lastAccessTime: Date.now(),
        isDormant: false
      }
      addTabToPane(paneId, newTab)
      return newTab.id
    },
    [panes.root, setActiveTab, addTabToPane]
  )

  const openTabInActivePane = useCallback(
    (url: string, options: OpenTabOptions = {}) => openTabInPane(activePaneId, url, options),
    [openTabInPane, activePaneId]
  )

  const closeTab = useCallback(
    (paneId: string, tabId: string) => {
      setPanes((prev) => {
        const leaf = findLeafById(prev.root, paneId)
        if (!leaf) return prev
        if (!leaf.tabs.some((t) => t.id === tabId)) return prev

        const filtered = leaf.tabs.filter((t) => t.id !== tabId)

        if (filtered.length === 0) {
          // Remove the empty leaf; normalize() will auto-collapse parent splits
          // and seed default state if the tree becomes empty.
          const nextRoot = removeLeafById(prev.root, paneId)
          return {
            root: nextRoot ?? prev.root, // normalize handles null
            activePaneId: prev.activePaneId
          }
        }

        let nextActiveTabId = leaf.activeTabId
        if (leaf.activeTabId === tabId) {
          const idx = leaf.tabs.findIndex((t) => t.id === tabId)
          const fallback = filtered[idx - 1] ?? filtered[idx] ?? filtered[0]
          nextActiveTabId = fallback?.id ?? ''
        }

        const nextRoot = updateLeafById(prev.root, paneId, (l) => ({
          ...l,
          tabs: filtered,
          activeTabId: nextActiveTabId
        }))
        return { ...prev, root: nextRoot }
      })
    },
    [setPanes]
  )

  const pinTab = useCallback(
    (paneId: string, tabId: string) => {
      updateTab(paneId, tabId, { isPinned: true })
      logger.info('Tab pinned', { paneId, tabId })
    },
    [updateTab]
  )

  const unpinTab = useCallback(
    (paneId: string, tabId: string) => {
      updateTab(paneId, tabId, { isPinned: false })
      logger.info('Tab unpinned', { paneId, tabId })
    },
    [updateTab]
  )

  const reorderTabsInPane = useCallback(
    (paneId: string, oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      setPanes((prev) => {
        const leaf = findLeafById(prev.root, paneId)
        if (!leaf) return prev
        const tabs = [...leaf.tabs]
        const [moved] = tabs.splice(oldIndex, 1)
        if (!moved) return prev
        tabs.splice(newIndex, 0, moved)
        const nextRoot = updateLeafById(prev.root, paneId, (l) => ({ ...l, tabs }))
        return { ...prev, root: nextRoot }
      })
    },
    [setPanes]
  )

  const hibernateTab = useCallback(
    (paneId: string, tabId: string) => {
      setPanes((prev) => {
        const leaf = findLeafById(prev.root, paneId)
        if (!leaf) return prev
        const tab = leaf.tabs.find((t) => t.id === tabId)
        if (!tab || tab.isDormant) return prev
        const savedState: TabSavedState = { scrollPosition: 0 }
        logger.info('Tab hibernated (manual)', { paneId, tabId, route: tab.url })
        const nextRoot = updateLeafById(prev.root, paneId, (l) => ({
          ...l,
          tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, isDormant: true, savedState } : t))
        }))
        return { ...prev, root: nextRoot }
      })
    },
    [setPanes]
  )

  const wakeTab = useCallback(
    (paneId: string, tabId: string) => {
      setPanes((prev) => {
        const leaf = findLeafById(prev.root, paneId)
        if (!leaf) return prev
        const tab = leaf.tabs.find((t) => t.id === tabId)
        if (!tab || !tab.isDormant) return prev
        logger.info('Tab awakened', { paneId, tabId, route: tab.url })
        const nextRoot = updateLeafById(prev.root, paneId, (l) => ({
          ...l,
          tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, isDormant: false, lastAccessTime: Date.now() } : t))
        }))
        return { ...prev, root: nextRoot }
      })
    },
    [setPanes]
  )

  const splitPane = useCallback(
    (paneId: string, direction: PaneDirection, seedTab?: PaneTab) => {
      setPanes((prev) => {
        const leaf = findLeafById(prev.root, paneId)
        if (!leaf) return prev

        // Use the pane's active tab as the seed if not supplied.
        const source = seedTab ?? leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0]
        if (!source) return prev

        const newPaneId = uuid()
        const newLeaf: LeafPane = {
          type: 'leaf',
          paneId: newPaneId,
          tabs: [
            {
              ...source,
              id: uuid(), // clone into a distinct tab id
              lastAccessTime: Date.now(),
              isDormant: false
            }
          ],
          activeTabId: ''
        }
        // Set activeTabId to the single tab we just created.
        newLeaf.activeTabId = newLeaf.tabs[0].id

        const nextRoot = splitLeaf(prev.root, paneId, direction, newLeaf, 'after')
        logger.info('Pane split', { from: paneId, newPaneId, direction })
        return { root: nextRoot, activePaneId: newPaneId }
      })
    },
    [setPanes]
  )

  /**
   * Collapse the split that contains the given leaf by removing the leaf.
   * The sibling auto-survives via removeLeafById's collapse behaviour.
   */
  const unsplitPane = useCallback(
    (paneId: string) => {
      setPanes((prev) => {
        const nextRoot = removeLeafById(prev.root, paneId)
        if (!nextRoot) return prev
        logger.info('Pane unsplit', { removed: paneId })
        return { ...prev, root: nextRoot }
      })
    },
    [setPanes]
  )

  const updateSplitRatio = useCallback(
    (path: number[], ratio: number) => {
      setPanes((prev) => ({ ...prev, root: updateRatioAtPath(prev.root, path, ratio) }))
    },
    [setPanes]
  )

  // ─── Detach / Attach ────────────────────────────────────────────────────────

  const detachTab = useCallback(
    (paneId: string, tabId: string) => {
      const found = findTabInTree(panes.root, tabId)
      if (!found) return
      window.electron.ipcRenderer.send(IpcChannel.Tab_Detach, found.tab)
      closeTab(paneId, tabId)
    },
    [panes.root, closeTab]
  )

  const attachTab = useCallback(
    (tab: PaneTab) => {
      setPanes((prev) => {
        // If the tab already exists somewhere, activate it.
        const existing = findTabInTree(prev.root, tab.id)
        if (existing) {
          return runLRU({
            root: updateLeafById(prev.root, existing.paneId, (l) => ({
              ...l,
              activeTabId: tab.id,
              tabs: l.tabs.map((t) => (t.id === tab.id ? { ...t, isDormant: false, lastAccessTime: Date.now() } : t))
            })),
            activePaneId: existing.paneId
          })
        }
        // Otherwise, append to active pane.
        const targetPaneId = findLeafById(prev.root, prev.activePaneId)?.paneId ?? firstLeaf(prev.root).paneId
        const fresh: PaneTab = { ...tab, lastAccessTime: Date.now(), isDormant: false }
        const nextRoot = updateLeafById(prev.root, targetPaneId, (l) => ({
          ...l,
          tabs: [...l.tabs, fresh],
          activeTabId: fresh.id
        }))
        logger.info('Tab attached from detached window', { tabId: tab.id, paneId: targetPaneId })
        return runLRU({ root: nextRoot, activePaneId: targetPaneId })
      })
    },
    [setPanes, runLRU]
  )

  // Listen for attach IPC from the main process.
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return
    const handler = (_event: unknown, tab: PaneTab) => attachTab(tab)
    return window.electron.ipcRenderer.on(IpcChannel.Tab_Attach, handler)
  }, [attachTab])

  const value: PanesContextValue = {
    panes: panesView,
    activePaneId,
    activePane,
    activeTab,
    isLoading: false,

    openTabInPane,
    openTabInActivePane,
    setActiveTab,
    setActivePane,
    closeTab,
    updateTab,

    pinTab,
    unpinTab,

    reorderTabsInPane,

    splitPane,
    unsplitPane,
    updateSplitRatio,

    hibernateTab,
    wakeTab,

    detachTab,
    attachTab
  }

  return <PanesContext value={value}>{children}</PanesContext>
}

export function usePanesContext(): PanesContextValue {
  const context = use(PanesContext)
  if (!context) {
    throw new Error('usePanesContext must be used within a PanesProvider')
  }
  return context
}
