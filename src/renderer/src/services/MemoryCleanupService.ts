import { loggerService } from '@logger'

import BlockCompressionService from './BlockCompressionService'

const logger = loggerService.withContext('MemoryCleanupService')

class MemoryCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null
  private readonly CLEANUP_INTERVAL = 15 * 60 * 1000 // 15分钟

  constructor() {
    this.init()
  }

  private init() {
    this.cleanupInterval = setInterval(() => {
      this.performCleanup()
    }, this.CLEANUP_INTERVAL)
  }

  private performCleanup() {
    try {
      logger.debug('Performing periodic memory cleanup')

      // 1. 压缩大块内容
      BlockCompressionService.compressLargeBlocks()

      // 2. 清理已完成的节流器（超过10分钟的）
      this.cleanupExpiredThrottles()

      logger.debug('Memory cleanup completed')
    } catch (error) {
      logger.error('Error during memory cleanup:', error as Error)
    }
  }

  private cleanupExpiredThrottles() {
    // 这里可以实现更精细的清理逻辑，目前直接清理所有
    // 在生产环境中，可以根据时间戳清理过期的节流器
    logger.debug('Cleaning up expired throttles')
    // 暂时不执行全部清理，防止影响正在使用的节流器
    // cleanupAllThrottledUpdates()
  }

  public destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    // 清理压缩服务的缓存
    BlockCompressionService.clearCache()
  }
}

export default new MemoryCleanupService()
