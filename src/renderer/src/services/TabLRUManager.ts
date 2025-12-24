import { loggerService } from '@logger'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

const logger = loggerService.withContext('TabLRU')

/**
 * Tab LRU limits configuration
 *
 * Controls when inactive tabs should be hibernated to save memory.
 * TODO: 后续可从偏好设置注入
 */
export const TAB_LIMITS = {
  /**
   * 软上限：活跃标签数超过此值时触发 LRU 休眠
   * 默认 10，可根据实际内存使用情况调整
   */
  softCap: 10,

  /**
   * 硬保险丝：极端兜底，防止 runaway
   * 当活跃标签数超过此值时，强制休眠超额部分
   */
  hardCap: 22
}

export type TabLimits = typeof TAB_LIMITS

/**
 * TabLRUManager - 管理标签页的 LRU 休眠策略
 *
 * 功能：
 * - 当活跃标签数超过软上限时，选择 LRU 候选进行休眠
 * - 硬保险丝作为极端兜底，防止内存失控
 * - 支持豁免机制：当前标签、首页、置顶标签不参与休眠
 */
export class TabLRUManager {
  private softCap: number
  private hardCap: number

  constructor(limits: TabLimits = TAB_LIMITS) {
    this.softCap = limits.softCap
    this.hardCap = limits.hardCap
  }

  /**
   * 检查并返回需要休眠的标签 ID 列表
   *
   * 策略：
   * - 超过 softCap：休眠到 softCap
   * - 超过 hardCap：强制休眠到 softCap（忽略部分豁免，仅保留当前+首页）
   *
   * @param tabs 所有标签
   * @param activeTabId 当前活动标签 ID
   * @returns 需要休眠的标签 ID 数组
   */
  checkAndGetDormantCandidates(tabs: Tab[], activeTabId: string): string[] {
    const activeTabs = tabs.filter((t) => !t.isDormant)
    const activeCount = activeTabs.length

    // 未超软上限，无需休眠
    if (activeCount <= this.softCap) {
      return []
    }

    const isHardCapTriggered = activeCount > this.hardCap

    // 获取候选列表
    // 硬保险丝触发时，使用更宽松的豁免规则（仅保留当前+首页）
    const candidates = isHardCapTriggered
      ? this.getHardCapCandidates(activeTabs, activeTabId)
      : this.getLRUCandidates(activeTabs, activeTabId)

    // 计算需要休眠的数量：始终休眠到 softCap
    let toHibernateCount = activeCount - this.softCap

    if (isHardCapTriggered) {
      logger.warn('Hard cap triggered - using relaxed exemption rules', {
        activeCount,
        hardCap: this.hardCap,
        softCap: this.softCap,
        toHibernate: toHibernateCount
      })
    }

    // 只能休眠可用的候选数量
    toHibernateCount = Math.min(toHibernateCount, candidates.length)

    // 检查是否能达到目标
    const afterHibernation = activeCount - toHibernateCount
    if (isHardCapTriggered && afterHibernation > this.hardCap) {
      // 极端情况：即使放宽豁免，仍无法降到 hardCap 以下
      logger.error('Cannot guarantee hard cap - insufficient candidates', {
        activeCount,
        candidatesAvailable: candidates.length,
        willHibernate: toHibernateCount,
        afterHibernation,
        hardCap: this.hardCap
      })
    } else if (afterHibernation > this.softCap) {
      // 一般情况：无法降到 softCap，但仍在 hardCap 以下
      logger.warn('Cannot reach soft cap - limited by available candidates', {
        activeCount,
        candidatesAvailable: candidates.length,
        willHibernate: toHibernateCount,
        afterHibernation,
        softCap: this.softCap
      })
    }

    const result = candidates.slice(0, toHibernateCount).map((t) => t.id)

    if (result.length > 0) {
      logger.info('Tabs selected for hibernation', {
        count: result.length,
        ids: result,
        activeCount,
        softCap: this.softCap,
        hardCapTriggered: isHardCapTriggered
      })
    }

    return result
  }

  /**
   * 硬保险丝候选列表（仅豁免当前标签和首页）
   */
  private getHardCapCandidates(tabs: Tab[], activeTabId: string): Tab[] {
    return tabs
      .filter((tab) => !this.isHardExempt(tab, activeTabId))
      .sort((a, b) => (a.lastAccessTime ?? 0) - (b.lastAccessTime ?? 0))
  }

  /**
   * 硬保险丝豁免判断（更严格，仅保留当前+首页）
   */
  private isHardExempt(tab: Tab, activeTabId: string): boolean {
    return (
      tab.id === activeTabId || // 当前活动标签
      tab.id === 'home' || // 首页
      tab.isDormant === true // 已休眠的不再参与
    )
    // 注意：isPinned 在硬保险丝触发时不再豁免
  }

  /**
   * 获取 LRU 候选列表（排除豁免项，按访问时间升序）
   */
  private getLRUCandidates(tabs: Tab[], activeTabId: string): Tab[] {
    return tabs
      .filter((tab) => !this.isExempt(tab, activeTabId))
      .sort((a, b) => (a.lastAccessTime ?? 0) - (b.lastAccessTime ?? 0))
  }

  /**
   * 判断标签是否豁免休眠
   *
   * 豁免条件：
   * - 当前活动标签
   * - 首页标签 (id === 'home')
   * - 置顶标签 (isPinned)
   * - 已休眠的标签（不重复处理）
   */
  private isExempt(tab: Tab, activeTabId: string): boolean {
    return (
      tab.id === activeTabId || // 当前活动标签
      tab.id === 'home' || // 首页
      tab.isPinned === true || // 置顶标签
      tab.isDormant === true // 已休眠的不再参与
    )
  }

  /**
   * 更新软上限（供未来设置页使用）
   */
  updateSoftCap(newSoftCap: number): void {
    this.softCap = newSoftCap
    logger.info('SoftCap updated', { newSoftCap })
  }

  /**
   * 更新硬上限（供未来设置页使用）
   */
  updateHardCap(newHardCap: number): void {
    this.hardCap = newHardCap
    logger.info('HardCap updated', { newHardCap })
  }

  /**
   * 获取当前配置
   */
  getLimits(): TabLimits {
    return {
      softCap: this.softCap,
      hardCap: this.hardCap
    }
  }
}
