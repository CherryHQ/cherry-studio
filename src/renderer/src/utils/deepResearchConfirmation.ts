// Deep Research确认机制管理
interface DeepResearchResolver {
  blockId: string
  resolve: (userSupplementInfo?: string) => void
  createdAt: number
}

class DeepResearchConfirmationManager {
  private resolvers = new Map<string, DeepResearchResolver>()

  // 注册一个resolver
  registerResolver(blockId: string, resolve: (userSupplementInfo?: string) => void): void {
    this.resolvers.set(blockId, {
      blockId,
      resolve,
      createdAt: Date.now()
    })
  }

  // 触发resolver并传递用户补全信息
  triggerResolver(blockId: string, userSupplementInfo?: string): boolean {
    const resolver = this.resolvers.get(blockId)
    if (resolver) {
      resolver.resolve(userSupplementInfo)
      this.resolvers.delete(blockId)
      return true
    }
    return false
  }

  // 清理resolver
  clearResolver(blockId: string): void {
    this.resolvers.delete(blockId)
  }

  // 检查是否存在resolver
  hasResolver(blockId: string): boolean {
    return this.resolvers.has(blockId)
  }

  // 清理过期的resolvers (超过10分钟)
  cleanupExpiredResolvers(): void {
    const now = Date.now()
    const expireTime = 10 * 60 * 1000 // 10分钟

    for (const [blockId, resolver] of this.resolvers.entries()) {
      if (now - resolver.createdAt > expireTime) {
        this.resolvers.delete(blockId)
      }
    }
  }

  // 获取所有pending的message IDs
  getPendingblockIds(): string[] {
    return Array.from(this.resolvers.keys())
  }
}

// 导出单例实例
export const deepResearchConfirmation = new DeepResearchConfirmationManager()

// 定期清理过期的resolvers
setInterval(
  () => {
    deepResearchConfirmation.cleanupExpiredResolvers()
  },
  5 * 60 * 1000
) // 每5分钟清理一次
