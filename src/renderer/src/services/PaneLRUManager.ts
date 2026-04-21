import { loggerService } from '@logger'
import type { PaneLayout, PaneTab } from '@shared/data/cache/cacheValueTypes'

import { collectAllLeafIds, collectAllTabs, findLeafById } from '../utils/paneTree'

const logger = loggerService.withContext('PaneLRU')

/**
 * LRU caps — same values as the retired TabLRUManager for behaviour parity.
 */
export const PANE_LRU_LIMITS = {
  /** Soft cap — when exceeded, LRU candidates are hibernated down to this count. */
  softCap: 10,
  /** Hard cap — absolute fuse; relaxes exemptions so we cannot go runaway. */
  hardCap: 22
}

export type PaneLRULimits = typeof PANE_LRU_LIMITS

export interface PaneTabRef {
  paneId: string
  tabId: string
}

/**
 * Global, cross-pane LRU manager.
 *
 * Differences vs TabLRUManager:
 *   - Operates on the whole PaneLayout tree instead of a flat Tab[].
 *   - Exempts every leaf's `activeTabId` (so switching to another pane doesn't
 *     immediately trigger a cold-load for its visible tab).
 *   - Returns `{ paneId, tabId }` refs so callers can navigate the tree.
 */
export class PaneLRUManager {
  private softCap: number
  private hardCap: number

  constructor(limits: PaneLRULimits = PANE_LRU_LIMITS) {
    this.softCap = limits.softCap
    this.hardCap = limits.hardCap
  }

  /**
   * Examine the layout and return tabs that should be hibernated.
   *
   * @param root - the current pane layout tree
   * @param activePaneId - the focus pane (for logging only; already covered by per-leaf exemption)
   */
  checkAndGetDormantCandidates(root: PaneLayout, activePaneId: string): PaneTabRef[] {
    const all = collectAllTabs(root)
    const live = all.filter(({ tab }) => !tab.isDormant)
    const activeCount = live.length

    if (activeCount <= this.softCap) {
      return []
    }

    const perLeafActiveTabIds = this.collectPerLeafActiveTabIds(root)
    const isHardCapTriggered = activeCount > this.hardCap

    const candidates = isHardCapTriggered
      ? this.getHardCapCandidates(live, perLeafActiveTabIds)
      : this.getLRUCandidates(live, perLeafActiveTabIds)

    let toHibernateCount = activeCount - this.softCap

    if (isHardCapTriggered) {
      logger.warn('Hard cap triggered — relaxed exemptions', {
        activeCount,
        hardCap: this.hardCap,
        softCap: this.softCap,
        activePaneId
      })
    }

    toHibernateCount = Math.min(toHibernateCount, candidates.length)

    const afterHibernation = activeCount - toHibernateCount
    if (isHardCapTriggered && afterHibernation > this.hardCap) {
      logger.error('Cannot guarantee hard cap — insufficient candidates', {
        activeCount,
        available: candidates.length,
        willHibernate: toHibernateCount
      })
    } else if (afterHibernation > this.softCap) {
      logger.warn('Cannot reach soft cap — limited by candidate pool', {
        activeCount,
        available: candidates.length,
        willHibernate: toHibernateCount
      })
    }

    const picks = candidates.slice(0, toHibernateCount)
    const result: PaneTabRef[] = picks.map(({ paneId, tab }) => ({ paneId, tabId: tab.id }))

    if (result.length > 0) {
      logger.info('Tabs selected for hibernation', {
        count: result.length,
        refs: result,
        activeCount,
        softCap: this.softCap,
        hardCapTriggered: isHardCapTriggered
      })
    }

    return result
  }

  /** Build the set of "must keep visible" tab ids — one per leaf. */
  private collectPerLeafActiveTabIds(root: PaneLayout): Set<string> {
    const ids = new Set<string>()
    for (const paneId of collectAllLeafIds(root)) {
      const leaf = findLeafById(root, paneId)
      if (leaf?.activeTabId) ids.add(leaf.activeTabId)
    }
    return ids
  }

  private getLRUCandidates(
    live: Array<{ paneId: string; tab: PaneTab }>,
    activeTabIds: Set<string>
  ): Array<{ paneId: string; tab: PaneTab }> {
    return live
      .filter(({ tab }) => !this.isExempt(tab, activeTabIds))
      .sort((a, b) => (a.tab.lastAccessTime ?? 0) - (b.tab.lastAccessTime ?? 0))
  }

  private getHardCapCandidates(
    live: Array<{ paneId: string; tab: PaneTab }>,
    activeTabIds: Set<string>
  ): Array<{ paneId: string; tab: PaneTab }> {
    return live
      .filter(({ tab }) => !this.isHardExempt(tab, activeTabIds))
      .sort((a, b) => (a.tab.lastAccessTime ?? 0) - (b.tab.lastAccessTime ?? 0))
  }

  /**
   * Soft-cap exemption:
   *   - any leaf's currently-visible tab
   *   - the hard-coded home tab (parity with TabLRUManager)
   *   - pinned tabs
   *   - already dormant (nothing to do)
   */
  private isExempt(tab: PaneTab, activeTabIds: Set<string>): boolean {
    return activeTabIds.has(tab.id) || tab.id === 'home' || tab.isPinned === true || tab.isDormant === true
  }

  /**
   * Hard-cap exemption relaxes the `isPinned` rule — we still keep each leaf's
   * visible tab and the home tab, but pinned tabs become fair game to avoid
   * runaway memory.
   */
  private isHardExempt(tab: PaneTab, activeTabIds: Set<string>): boolean {
    return activeTabIds.has(tab.id) || tab.id === 'home' || tab.isDormant === true
  }

  updateSoftCap(newSoftCap: number): void {
    this.softCap = newSoftCap
    logger.info('SoftCap updated', { newSoftCap })
  }

  updateHardCap(newHardCap: number): void {
    this.hardCap = newHardCap
    logger.info('HardCap updated', { newHardCap })
  }

  getLimits(): PaneLRULimits {
    return { softCap: this.softCap, hardCap: this.hardCap }
  }
}
