import type { LeafPane, PaneLayout, PaneTab } from '@shared/data/cache/cacheValueTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PANE_LRU_LIMITS, PaneLRUManager, type PaneTabRef } from '../PaneLRUManager'

const createTab = (id: string, overrides: Partial<PaneTab> = {}): PaneTab => ({
  id,
  type: 'route',
  url: `/${id}`,
  title: id,
  lastAccessTime: Date.now(),
  isDormant: false,
  isPinned: false,
  ...overrides
})

/**
 * Wrap all tabs in a single-leaf root tree. Simplest test shape —
 * equivalent to the legacy flat-list scenarios.
 */
const singleLeaf = (tabs: PaneTab[], activeTabId = tabs[0]?.id ?? ''): PaneLayout => ({
  type: 'leaf',
  paneId: 'root',
  tabs,
  activeTabId
})

/** Build a two-pane horizontal split layout for cross-pane tests. */
const twoPaneSplit = (
  leftTabs: PaneTab[],
  rightTabs: PaneTab[],
  leftActive = leftTabs[0]?.id ?? '',
  rightActive = rightTabs[0]?.id ?? ''
): PaneLayout => ({
  type: 'split',
  direction: 'horizontal',
  ratio: 50,
  children: [
    { type: 'leaf', paneId: 'left', tabs: leftTabs, activeTabId: leftActive },
    { type: 'leaf', paneId: 'right', tabs: rightTabs, activeTabId: rightActive }
  ]
})

const toTabIds = (refs: PaneTabRef[]): string[] => refs.map((r) => r.tabId)

describe('PaneLRUManager', () => {
  let manager: PaneLRUManager

  beforeEach(() => {
    manager = new PaneLRUManager()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('constructor', () => {
    it('uses default limits', () => {
      expect(manager.getLimits()).toEqual(PANE_LRU_LIMITS)
    })

    it('accepts custom limits', () => {
      const custom = new PaneLRUManager({ softCap: 5, hardCap: 15 })
      expect(custom.getLimits()).toEqual({ softCap: 5, hardCap: 15 })
    })
  })

  describe('under the soft cap', () => {
    it('returns empty when active tab count is at or below softCap', () => {
      const tabs = Array.from({ length: PANE_LRU_LIMITS.softCap }, (_, i) => createTab(`t-${i}`))
      expect(manager.checkAndGetDormantCandidates(singleLeaf(tabs), 'root')).toEqual([])
    })

    it('returns empty for a single tab', () => {
      expect(manager.checkAndGetDormantCandidates(singleLeaf([createTab('t-0')]), 'root')).toEqual([])
    })
  })

  describe('over the soft cap', () => {
    it('hibernates the oldest tabs down to softCap', () => {
      const now = Date.now()
      const tabs = Array.from({ length: PANE_LRU_LIMITS.softCap + 3 }, (_, i) =>
        createTab(`t-${i}`, { lastAccessTime: now + i * 1000 })
      )
      const activeId = `t-${PANE_LRU_LIMITS.softCap + 2}`
      const result = toTabIds(manager.checkAndGetDormantCandidates(singleLeaf(tabs, activeId), 'root'))
      expect(result.length).toBe(3)
      expect(result).toEqual(expect.arrayContaining(['t-0', 't-1', 't-2']))
    })

    it('never hibernates the active tab of a leaf', () => {
      const now = Date.now()
      const tabs = Array.from({ length: PANE_LRU_LIMITS.softCap + 2 }, (_, i) =>
        createTab(`t-${i}`, { lastAccessTime: now + i * 1000 })
      )
      // Put the oldest tab as the leaf's active tab
      const result = toTabIds(manager.checkAndGetDormantCandidates(singleLeaf(tabs, 't-0'), 'root'))
      expect(result).not.toContain('t-0')
    })

    it('never hibernates the home tab', () => {
      const now = Date.now()
      const tabs = [
        createTab('home', { lastAccessTime: now - 10000 }),
        ...Array.from({ length: PANE_LRU_LIMITS.softCap + 1 }, (_, i) =>
          createTab(`t-${i}`, { lastAccessTime: now + i * 1000 })
        )
      ]
      const result = toTabIds(
        manager.checkAndGetDormantCandidates(singleLeaf(tabs, `t-${PANE_LRU_LIMITS.softCap}`), 'root')
      )
      expect(result).not.toContain('home')
    })

    it('never hibernates pinned tabs in soft-cap mode', () => {
      const now = Date.now()
      const tabs = [
        createTab('pinned', { lastAccessTime: now - 10000, isPinned: true }),
        ...Array.from({ length: PANE_LRU_LIMITS.softCap + 1 }, (_, i) =>
          createTab(`t-${i}`, { lastAccessTime: now + i * 1000 })
        )
      ]
      const result = toTabIds(
        manager.checkAndGetDormantCandidates(singleLeaf(tabs, `t-${PANE_LRU_LIMITS.softCap}`), 'root')
      )
      expect(result).not.toContain('pinned')
    })

    it('never hibernates already-dormant tabs', () => {
      const now = Date.now()
      const tabs = [
        createTab('sleeper', { lastAccessTime: now - 10000, isDormant: true }),
        ...Array.from({ length: PANE_LRU_LIMITS.softCap + 1 }, (_, i) =>
          createTab(`t-${i}`, { lastAccessTime: now + i * 1000 })
        )
      ]
      const result = toTabIds(
        manager.checkAndGetDormantCandidates(singleLeaf(tabs, `t-${PANE_LRU_LIMITS.softCap}`), 'root')
      )
      expect(result).not.toContain('sleeper')
    })
  })

  describe('hard cap', () => {
    it('relaxes pinned-tab exemption when over hard cap', () => {
      const now = Date.now()
      const tabs = [
        createTab('pinned-old', { lastAccessTime: now - 20000, isPinned: true }),
        ...Array.from({ length: PANE_LRU_LIMITS.hardCap + 2 }, (_, i) =>
          createTab(`t-${i}`, { lastAccessTime: now + i * 1000 })
        )
      ]
      const result = toTabIds(
        manager.checkAndGetDormantCandidates(singleLeaf(tabs, `t-${PANE_LRU_LIMITS.hardCap + 1}`), 'root')
      )
      expect(result).toContain('pinned-old')
    })

    it('still protects the home tab and active tab in hard-cap mode', () => {
      const now = Date.now()
      const tabs = [
        createTab('home', { lastAccessTime: now - 30000 }),
        ...Array.from({ length: PANE_LRU_LIMITS.hardCap + 2 }, (_, i) =>
          createTab(`t-${i}`, { lastAccessTime: now + i * 1000 })
        )
      ]
      const activeId = `t-${PANE_LRU_LIMITS.hardCap + 1}`
      const result = toTabIds(manager.checkAndGetDormantCandidates(singleLeaf(tabs, activeId), 'root'))
      expect(result).not.toContain('home')
      expect(result).not.toContain(activeId)
    })
  })

  describe('multi-pane behaviour', () => {
    it('exempts the active tab of every leaf (not just the global active pane)', () => {
      const now = Date.now()
      // 6 tabs on the left pane, 6 tabs on the right — 12 total, over softCap of 10.
      const leftTabs = Array.from({ length: 6 }, (_, i) => createTab(`L-${i}`, { lastAccessTime: now + i * 1000 }))
      const rightTabs = Array.from({ length: 6 }, (_, i) =>
        createTab(`R-${i}`, { lastAccessTime: now + 10000 + i * 1000 })
      )
      // Left active = L-0 (oldest); right active = R-0 (oldest)
      const layout = twoPaneSplit(leftTabs, rightTabs, 'L-0', 'R-0')
      const result = toTabIds(manager.checkAndGetDormantCandidates(layout, 'left'))

      expect(result).not.toContain('L-0')
      expect(result).not.toContain('R-0')
      // 12 live - 10 softCap = 2 should hibernate; must be from the non-active tabs.
      expect(result.length).toBe(2)
    })

    it('picks cross-pane LRU candidates by access time', () => {
      const now = Date.now()
      const leftTabs = [
        createTab('L-new', { lastAccessTime: now + 5000 }),
        createTab('L-old', { lastAccessTime: now - 9000 }),
        createTab('L-active', { lastAccessTime: now + 100 })
      ]
      const rightTabs = [
        createTab('R-oldest', { lastAccessTime: now - 10000 }),
        createTab('R-new', { lastAccessTime: now + 5000 }),
        createTab('R-active', { lastAccessTime: now + 200 })
      ]
      // Soft cap 3 — tiny manager for deterministic test; hard cap 10 so we stay in soft mode
      const smallManager = new PaneLRUManager({ softCap: 3, hardCap: 10 })
      const layout = twoPaneSplit(leftTabs, rightTabs, 'L-active', 'R-active')
      const result = toTabIds(smallManager.checkAndGetDormantCandidates(layout, 'left'))
      // 6 live - 3 soft cap = 3 must hibernate; exemptions protect L-active / R-active;
      // so the three oldest non-active tabs should be picked.
      expect(result.length).toBe(3)
      // Oldest first: R-oldest (-10000) then L-old (-9000) then one of the tied +5000s.
      expect(result[0]).toBe('R-oldest')
      expect(result[1]).toBe('L-old')
    })
  })

  describe('edge cases', () => {
    it('handles an empty leaf gracefully', () => {
      const layout: LeafPane = { type: 'leaf', paneId: 'root', tabs: [], activeTabId: '' }
      expect(manager.checkAndGetDormantCandidates(layout, 'root')).toEqual([])
    })

    it('handles tabs with undefined lastAccessTime', () => {
      const tabs = Array.from({ length: PANE_LRU_LIMITS.softCap + 2 }, (_, i) =>
        createTab(`t-${i}`, { lastAccessTime: undefined })
      )
      const result = manager.checkAndGetDormantCandidates(singleLeaf(tabs, `t-${PANE_LRU_LIMITS.softCap + 1}`), 'root')
      expect(Array.isArray(result)).toBe(true)
    })

    it('returns fewer than requested when all candidates are exempt', () => {
      const now = Date.now()
      const tabs = Array.from({ length: PANE_LRU_LIMITS.softCap + 3 }, (_, i) =>
        createTab(`t-${i}`, { lastAccessTime: now + i * 1000, isPinned: true })
      )
      const result = manager.checkAndGetDormantCandidates(singleLeaf(tabs, 't-0'), 'root')
      expect(result.length).toBeLessThan(3)
    })

    it('ignores already-dormant tabs when counting activeCount', () => {
      const now = Date.now()
      const dormants = Array.from({ length: 5 }, (_, i) =>
        createTab(`d-${i}`, { isDormant: true, lastAccessTime: now - i * 1000 })
      )
      const live = Array.from({ length: PANE_LRU_LIMITS.softCap + 2 }, (_, i) =>
        createTab(`a-${i}`, { lastAccessTime: now + i * 1000 })
      )
      const result = toTabIds(
        manager.checkAndGetDormantCandidates(
          singleLeaf([...dormants, ...live], `a-${PANE_LRU_LIMITS.softCap + 1}`),
          'root'
        )
      )
      expect(result.every((id) => id.startsWith('a-'))).toBe(true)
      expect(result.length).toBe(2)
    })
  })

  describe('cap mutation', () => {
    it('updateSoftCap changes softCap', () => {
      manager.updateSoftCap(15)
      expect(manager.getLimits().softCap).toBe(15)
    })

    it('updateHardCap changes hardCap', () => {
      manager.updateHardCap(30)
      expect(manager.getLimits().hardCap).toBe(30)
    })
  })

  describe('LRU ordering', () => {
    it('orders hibernation candidates by lastAccessTime ascending', () => {
      const small = new PaneLRUManager({ softCap: 3, hardCap: 10 })
      const now = Date.now()
      const tabs = [
        createTab('oldest', { lastAccessTime: now - 3000 }),
        createTab('newest', { lastAccessTime: now }),
        createTab('middle', { lastAccessTime: now - 1000 }),
        createTab('second-oldest', { lastAccessTime: now - 2000 }),
        createTab('active', { lastAccessTime: now + 1000 })
      ]
      const result = toTabIds(small.checkAndGetDormantCandidates(singleLeaf(tabs, 'active'), 'root'))
      expect(result.length).toBe(2)
      expect(result[0]).toBe('oldest')
      expect(result[1]).toBe('second-oldest')
    })
  })
})
