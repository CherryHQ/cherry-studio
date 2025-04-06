import store from '@renderer/store'
import LRUCache from 'lru-cache'

/**
 * FNV-1a哈希函数，用于计算字符串哈希值
 * @param input 输入字符串
 * @param maxInputLength 最大计算长度，默认50000字符
 * @returns 哈希值的36进制字符串表示
 */
const fastHash = (input: string, maxInputLength: number = 50000) => {
  let hash = 2166136261 // FNV偏移基数
  const count = Math.min(input.length, maxInputLength)
  for (let i = 0; i < count; i++) {
    hash ^= input.charCodeAt(i)
    hash *= 16777619 // FNV素数
    hash >>>= 0 // 保持为32位无符号整数
  }
  return hash.toString(36)
}

/**
 * 增强的哈希函数，对长内容使用三段采样计算哈希
 * @param input 输入字符串
 * @returns 哈希值或组合哈希值
 */
const enhancedHash = (input: string) => {
  const THRESHOLD = 50000

  if (input.length <= THRESHOLD) {
    return fastHash(input)
  }

  const mid = Math.floor(input.length / 2)

  // 三段hash保证唯一性
  const frontSection = input.slice(0, 10000)
  const midSection = input.slice(mid - 15000, mid + 15000)
  const endSection = input.slice(-10000)

  return `${fastHash(frontSection)}-${fastHash(midSection)}-${fastHash(endSection)}`
}

// 高亮结果缓存实例
let highlightCache: LRUCache<string, string> | null = null

/**
 * 检查缓存设置是否发生变化
 */
const haveSettingsChanged = (prev: any, current: any) => {
  if (!prev || !current) return true

  return (
    prev.codeCacheable !== current.codeCacheable ||
    prev.codeCacheMaxSize !== current.codeCacheMaxSize ||
    prev.codeCacheTTL !== current.codeCacheTTL ||
    prev.codeCacheThreshold !== current.codeCacheThreshold
  )
}

/**
 * 代码缓存服务
 * 提供代码高亮结果的缓存管理和哈希计算功能
 */
export const CodeCacheService = {
  /**
   * 缓存上次使用的配置
   */
  _lastConfig: {
    codeCacheable: false,
    codeCacheMaxSize: 0,
    codeCacheTTL: 0,
    codeCacheThreshold: 0
  },

  /**
   * 获取当前缓存配置
   * @returns 当前配置对象
   */
  getConfig() {
    try {
      if (!store || !store.getState) return this._lastConfig

      const { codeCacheable, codeCacheMaxSize, codeCacheTTL, codeCacheThreshold } = store.getState().settings

      return { codeCacheable, codeCacheMaxSize, codeCacheTTL, codeCacheThreshold }
    } catch (error) {
      console.warn('[CodeCacheService] Failed to get config', error)
      return this._lastConfig
    }
  },

  /**
   * 检查并确保缓存配置是最新的
   * 每次缓存操作前调用
   * @returns 当前缓存实例或null
   */
  ensureCache() {
    const currentConfig = this.getConfig()

    // 检查配置是否变化
    if (haveSettingsChanged(this._lastConfig, currentConfig)) {
      this._lastConfig = currentConfig
      this._updateCacheInstance(currentConfig)
    }

    return highlightCache
  },

  /**
   * 更新缓存实例
   * @param config 缓存配置
   */
  _updateCacheInstance(config: any) {
    try {
      const { codeCacheable, codeCacheMaxSize, codeCacheTTL } = config
      const newMaxSize = codeCacheMaxSize * 1000
      const newTTLMilliseconds = codeCacheTTL * 60 * 1000

      // 根据配置决定是否创建或清除缓存
      if (codeCacheable) {
        if (!highlightCache) {
          // 缓存不存在，创建新缓存
          highlightCache = new LRUCache<string, string>({
            max: 200, // 最大缓存条目数
            maxSize: newMaxSize, // 最大缓存大小
            sizeCalculation: (value) => value.length, // 缓存大小计算
            ttl: newTTLMilliseconds // 缓存过期时间（毫秒）
          })
          return
        }

        // 尝试从当前缓存获取配置信息
        const maxSize = highlightCache.max || 0
        const ttl = highlightCache.ttl || 0

        // 检查实际配置是否变化
        if (maxSize !== newMaxSize || ttl !== newTTLMilliseconds) {
          console.log('[CodeCacheService] Cache config changed, recreating cache')
          highlightCache.clear()
          highlightCache = new LRUCache<string, string>({
            max: 500,
            maxSize: newMaxSize,
            sizeCalculation: (value) => value.length,
            ttl: newTTLMilliseconds
          })
        }
      } else if (highlightCache) {
        // 缓存被禁用，清理资源
        highlightCache.clear()
        highlightCache = null
      }
    } catch (error) {
      console.warn('[CodeCacheService] Failed to update cache config', error)
    }
  },

  /**
   * 生成缓存键
   * @param code 代码内容
   * @param language 代码语言
   * @param theme 高亮主题
   * @returns 缓存键
   */
  generateCacheKey: (code: string, language: string, theme: string) => {
    return `${language}|${theme}|${code.length}|${enhancedHash(code)}`
  },

  /**
   * 获取缓存的高亮结果
   * @param key 缓存键
   * @returns 缓存的HTML或null
   */
  getCachedResult: (key: string) => {
    try {
      // 确保缓存配置是最新的
      CodeCacheService.ensureCache()

      if (!store || !store.getState) return null
      const { codeCacheable } = store.getState().settings
      if (!codeCacheable) return null

      return highlightCache?.get(key) || null
    } catch (error) {
      console.warn('[CodeCacheService] Failed to get cached result', error)
      return null
    }
  },

  /**
   * 设置缓存结果
   * @param key 缓存键
   * @param html 高亮HTML
   * @param codeLength 代码长度
   */
  setCachedResult: (key: string, html: string, codeLength: number) => {
    try {
      // 确保缓存配置是最新的
      CodeCacheService.ensureCache()

      if (!store || !store.getState) return
      const { codeCacheable, codeCacheThreshold } = store.getState().settings

      // 判断是否可以缓存
      if (!codeCacheable || codeLength < codeCacheThreshold * 1000) return

      highlightCache?.set(key, html)
    } catch (error) {
      console.warn('[CodeCacheService] Failed to set cached result', error)
    }
  },

  /**
   * 清空缓存
   */
  clear: () => {
    highlightCache?.clear()
  }
}
