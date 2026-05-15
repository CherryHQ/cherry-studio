import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TAB_LIMITS, TabLRUManager } from '../TabLRUManager'

// Helper to create a mock tab
const createTab = (id: string, overrides: Partial<Tab> = {}): Tab => ({
  id,
  type: 'route',
  url: `/${id}`,
  title: id,
  lastAccessTime: Date.now(),
  isDormant: false,
  isPinned: false,
  ...overrides
})

describe('TabLRUManager', () => {
  let manager: TabLRUManager

  beforeEach(() => {
    manager = new TabLRUManager()
    // Suppress logger output during tests
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('constructor', () => {
    it('should use default limits', () => {
      const limits = manager.getLimits()
      expect(limits.softCap).toBe(TAB_LIMITS.softCap)
      expect(limits.hardCap).toBe(TAB_LIMITS.hardCap)
    })

    it('should accept custom limits', () => {
      const customManager = new TabLRUManager({ softCap: 5, hardCap: 15 })
      const limits = customManager.getLimits()
      expect(limits.softCap).toBe(5)
      expect(limits.hardCap).toBe(15)
    })
  })

  describe('checkAndGetDormantCandidates', () => {
    describe('when under soft cap', () => {
      it('should return empty array when active tabs <= softCap', () => {
        const tabs = Array.from({ length: TAB_LIMITS.softCap }, (_, i) => createTab(`tab-${i}`))
        const result = manager.checkAndGetDormantCandidates(tabs, 'tab-0')
        expect(result).toEqual([])
      })

      it('should return empty array for 1 tab', () => {
        const tabs = [createTab('tab-0')]
        const result = manager.checkAndGetDormantCandidates(tabs, 'tab-0')
        expect(result).toEqual([])
      })
    })

    describe('when exceeding soft cap', () => {
      it('should return oldest tabs when exceeding softCap', () => {
        const now = Date.now()
        const tabs = Array.from({ length: TAB_LIMITS.softCap + 3 }, (_, i) =>
          createTab(`tab-${i}`, { lastAccessTime: now + i * 1000 })
        )

        const result = manager.checkAndGetDormantCandidates(tabs, `tab-${TAB_LIMITS.softCap + 2}`)

        // Should hibernate 3 tabs (to get back to softCap)
        expect(result.length).toBe(3)
        // Should be the oldest tabs (lowest access times)
        expect(result).toContain('tab-0')
        expect(result).toContain('tab-1')
        expect(result).toContain('tab-2')
      })

      it('should not hibernate the active tab', () => {
        const now = Date.now()
        const tabs = Array.from({ length: TAB_LIMITS.softCap + 2 }, (_, i) =>
          createTab(`tab-${i}`, { lastAccessTime: now + i * 1000 })
        )

        // Make tab-0 the oldest but also the active tab
        const result = manager.checkAndGetDormantCandidates(tabs, 'tab-0')

        expect(result).not.toContain('tab-0')
      })

      it('should not hibernate the home tab', () => {
        const now = Date.now()
        const tabs = [
          createTab('home', { lastAccessTime: now - 10000 }), // Oldest
          ...Array.from({ length: TAB_LIMITS.softCap + 1 }, (_, i) =>
            createTab(`tab-${i}`, { lastAccessTime: now + i * 1000 })
          )
        ]

        const result = manager.checkAndGetDormantCandidates(tabs, `tab-${TAB_LIMITS.softCap}`)

        expect(result).not.toContain('home')
      })

      it('should not hibernate pinned tabs', () => {
        const now = Date.now()
        const tabs = [
          createTab('pinned-tab', { lastAccessTime: now - 10000, isPinned: true }), // Oldest but pinned
          ...Array.from({ length: TAB_LIMITS.softCap + 1 }, (_, i) =>
            createTab(`tab-${i}`, { lastAccessTime: now + i * 1000 })
          )
        ]

        const result = manager.checkAndGetDormantCandidates(tabs, `tab-${TAB_LIMITS.softCap}`)

        expect(result).not.toContain('pinned-tab')
      })

      it('should not hibernate already dormant tabs', () => {
        const now = Date.now()
        const tabs = [
          createTab('dormant-tab', { lastAccessTime: now - 10000, isDormant: true }),
          ...Array.from({ length: TAB_LIMITS.softCap + 1 }, (_, i) =>
            createTab(`tab-${i}`, { lastAccessTime: now + i * 1000 })
          )
        ]

        const result = manager.checkAndGetDormantCandidates(tabs, `tab-${TAB_LIMITS.softCap}`)

        expect(result).not.toContain('dormant-tab')
      })
    })

    describe('hard cap behavior', () => {
      it('should use relaxed exemption rules when exceeding hard cap', () => {
        const now = Date.now()
        // Create tabs exceeding hard cap, with one pinned oldest tab
        const tabs = [
          createTab('pinned-old', { lastAccessTime: now - 20000, isPinned: true }),
          ...Array.from({ length: TAB_LIMITS.hardCap + 2 }, (_, i) =>
            createTab(`tab-${i}`, { lastAccessTime: now + i * 1000 })
          )
        ]

        const result = manager.checkAndGetDormantCandidates(tabs, `tab-${TAB_LIMITS.hardCap + 1}`)

        // Hard cap triggered: pinned tabs are no longer exempt (except home and active)
        expect(result).toContain('pinned-old')
      })

      it('should still protect home and active tabs in hard cap mode', () => {
        const now = Date.now()
        const tabs = [
          createTab('home', { lastAccessTime: now - 30000 }),
          ...Array.from({ length: TAB_LIMITS.hardCap + 2 }, (_, i) =>
            createTab(`tab-${i}`, { lastAccessTime: now + i * 1000 })
          )
        ]

        const activeTabId = `tab-${TAB_LIMITS.hardCap + 1}`
        const result = manager.checkAndGetDormantCandidates(tabs, activeTabId)

        expect(result).not.toContain('home')
        expect(result).not.toContain(activeTabId)
      })
    })

    describe('edge cases', () => {
      it('should handle empty tabs array', () => {
        const result = manager.checkAndGetDormantCandidates([], 'any-id')
        expect(result).toEqual([])
      })

      it('should handle tabs with undefined lastAccessTime', () => {
        const tabs = Array.from({ length: TAB_LIMITS.softCap + 2 }, (_, i) =>
          createTab(`tab-${i}`, { lastAccessTime: undefined })
        )

        // Should not throw
        const result = manager.checkAndGetDormantCandidates(tabs, `tab-${TAB_LIMITS.softCap + 1}`)
        expect(Array.isArray(result)).toBe(true)
      })

      it('should handle when all tabs are exempt', () => {
        const now = Date.now()
        // All tabs are pinned
        const tabs = Array.from({ length: TAB_LIMITS.softCap + 3 }, (_, i) =>
          createTab(`tab-${i}`, { lastAccessTime: now + i * 1000, isPinned: true })
        )

        const result = manager.checkAndGetDormantCandidates(tabs, 'tab-0')

        // Should return empty (no candidates available)
        expect(result.length).toBeLessThan(3)
      })

      it('should handle mixed dormant and active tabs correctly', () => {
        const now = Date.now()
        const tabs = [
          // 5 dormant tabs (should not count toward active)
          ...Array.from({ length: 5 }, (_, i) =>
            createTab(`dormant-${i}`, { isDormant: true, lastAccessTime: now - i * 1000 })
          ),
          // Active tabs exceeding soft cap
          ...Array.from({ length: TAB_LIMITS.softCap + 2 }, (_, i) =>
            createTab(`active-${i}`, { lastAccessTime: now + i * 1000 })
          )
        ]

        const result = manager.checkAndGetDormantCandidates(tabs, `active-${TAB_LIMITS.softCap + 1}`)

        // Should only consider active tabs
        expect(result.every((id) => id.startsWith('active-'))).toBe(true)
        expect(result.length).toBe(2) // Need to hibernate 2 to reach soft cap
      })
    })
  })

  describe('updateSoftCap', () => {
    it('should update soft cap value', () => {
      manager.updateSoftCap(15)
      expect(manager.getLimits().softCap).toBe(15)
    })
  })

  describe('updateHardCap', () => {
    it('should update hard cap value', () => {
      manager.updateHardCap(30)
      expect(manager.getLimits().hardCap).toBe(30)
    })
  })

  describe('getLimits', () => {
    it('should return current limits', () => {
      const customManager = new TabLRUManager({ softCap: 8, hardCap: 20 })
      const limits = customManager.getLimits()

      expect(limits).toEqual({ softCap: 8, hardCap: 20 })
    })
  })

  describe('LRU ordering', () => {
    it('should correctly order tabs by lastAccessTime', () => {
      const customManager = new TabLRUManager({ softCap: 3, hardCap: 10 })
      const now = Date.now()

      const tabs = [
        createTab('tab-oldest', { lastAccessTime: now - 3000 }),
        createTab('tab-newest', { lastAccessTime: now }),
        createTab('tab-middle', { lastAccessTime: now - 1000 }),
        createTab('tab-second-oldest', { lastAccessTime: now - 2000 }),
        createTab('tab-active', { lastAccessTime: now + 1000 }) // Active tab
      ]

      const result = customManager.checkAndGetDormantCandidates(tabs, 'tab-active')

      // Should hibernate the 2 oldest tabs
      expect(result.length).toBe(2)
      expect(result[0]).toBe('tab-oldest')
      expect(result[1]).toBe('tab-second-oldest')
    })
  })
})
