import store from '@renderer/store'
import { LRUCache } from 'lru-cache'

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
 * 初始化缓存
 * @returns 配置的LRU缓存实例或null
 */
const initializeCache = () => {
  const { codeCacheable, codeCacheMaxSize, codeCacheTTL } = store.getState().settings

  if (!codeCacheable) return null

  return new LRUCache<string, string>({
    max: 200, // 最大缓存条目数
    maxSize: codeCacheMaxSize, // 最大缓存大小
    sizeCalculation: (value) => value.length, // 缓存大小计算
    ttl: codeCacheTTL * 60 * 1000 // 缓存过期时间（毫秒）
  })
}

/**
 * 代码缓存服务
 * 提供代码高亮结果的缓存管理和哈希计算功能
 */
export const CodeCacheService = {
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
    if (!highlightCache) {
      highlightCache = initializeCache()
    }

    const { codeCacheable } = store.getState().settings
    if (!codeCacheable) return null

    return highlightCache?.get(key) || null
  },

  /**
   * 设置缓存结果
   * @param key 缓存键
   * @param html 高亮HTML
   * @param codeLength 代码长度
   */
  setCachedResult: (key: string, html: string, codeLength: number) => {
    if (!highlightCache) {
      highlightCache = initializeCache()
    }

    const { codeCacheable, codeCacheThreshold } = store.getState().settings

    // 判断是否可以缓存
    if (!codeCacheable || codeLength < codeCacheThreshold) return

    highlightCache?.set(key, html)
  },

  /**
   * 更新缓存配置
   * 当设置变化时应该调用
   */
  updateConfig: () => {
    const { codeCacheable, codeCacheMaxSize, codeCacheTTL } = store.getState().settings

    // 根据配置决定是否创建或清除缓存
    if (codeCacheable) {
      if (!highlightCache) {
        highlightCache = initializeCache()
      } else {
        // 重新创建缓存以应用新设置
        highlightCache.clear()
        highlightCache = new LRUCache<string, string>({
          max: 200,
          maxSize: codeCacheMaxSize,
          sizeCalculation: (value) => value.length,
          ttl: codeCacheTTL * 60 * 1000
        })
      }
    } else if (highlightCache) {
      highlightCache.clear()
      highlightCache = null
    }
  },

  /**
   * 清空缓存
   */
  clear: () => {
    highlightCache?.clear()
  }
}

// 监听配置变化
store.subscribe(() => {
  CodeCacheService.updateConfig()
})

// 初始化服务
CodeCacheService.updateConfig()
