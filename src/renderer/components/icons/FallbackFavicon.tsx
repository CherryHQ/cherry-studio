import { type ReactNode, useEffect, useState } from 'react'

import { loggerService } from '@logger'

const logger = loggerService.withContext('FallbackFavicon')

// 记录失败的URL的缓存键前缀
const FAILED_FAVICON_CACHE_PREFIX = 'failed_favicon_'
// 失败URL的缓存时间 (24小时)
const FAILED_FAVICON_CACHE_DURATION = 24 * 60 * 60 * 1000
// 记录解析成功的图标的缓存键前缀
const RESOLVED_FAVICON_CACHE_PREFIX = 'favicon_src_'
// 成功图标保留时间 (7天)：站点换图标的机会成本远低于每次挂载都重新探测
const RESOLVED_FAVICON_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000
// 单个 hostname 的探测超时
const FAVICON_PROBE_TIMEOUT_MS = 2000

/** 拼出该 hostname 的候选图标地址，按可用性排序 */
const faviconUrlsFor = (hostname: string): string[] => [
  `https://icon.horse/icon/${hostname}`,
  `https://favicon.splitbee.io/?url=${hostname}`,
  `https://favicon.im/${hostname}`,
  `https://${hostname}/favicon.ico`
]

// 检查URL是否在失败缓存中
const isUrlFailedRecently = (url: string): boolean => {
  const cacheKey = `${FAILED_FAVICON_CACHE_PREFIX}${url}`

  try {
    const cachedTimestamp = localStorage.getItem(cacheKey)
    if (!cachedTimestamp) return false

    const timestamp = parseInt(cachedTimestamp, 10)
    const now = Date.now()

    // 如果时间戳在缓存期内，则认为URL仍处于失败状态
    if (now - timestamp < FAILED_FAVICON_CACHE_DURATION) {
      return true
    }

    // 清除过期的缓存
    localStorage.removeItem(cacheKey)
    return false
  } catch {
    return false
  }
}

// 记录失败的URL到缓存
const markUrlAsFailed = (url: string): void => {
  try {
    localStorage.setItem(`${FAILED_FAVICON_CACHE_PREFIX}${url}`, Date.now().toString())
  } catch {
    // 隐私模式等拿不到 localStorage 时静默降级为不缓存
  }
}

// 本次会话内已解析的图标：一份消息里同一个 hostname 可能挂载几十次，全部命中这里
const resolvedSrcByHostname = new Map<string, string>()
// 正在进行的探测：并发挂载共享同一次探测，避免 N 倍请求
const inflightByHostname = new Map<string, Promise<string>>()
// 本次会话内所有候选都失败过的 hostname，不再重复探测
const exhaustedHostnames = new Set<string>()

const readResolvedSrc = (hostname: string): string | undefined => {
  const inMemory = resolvedSrcByHostname.get(hostname)
  if (inMemory) return inMemory

  const cacheKey = `${RESOLVED_FAVICON_CACHE_PREFIX}${hostname}`

  try {
    const raw = localStorage.getItem(cacheKey)
    if (!raw) return undefined

    const entry = JSON.parse(raw) as { src?: string; at?: number }
    if (!entry.src || !entry.at || Date.now() - entry.at > RESOLVED_FAVICON_CACHE_DURATION) {
      localStorage.removeItem(cacheKey)
      return undefined
    }

    resolvedSrcByHostname.set(hostname, entry.src)
    return entry.src
  } catch {
    return undefined
  }
}

const writeResolvedSrc = (hostname: string, src: string): void => {
  resolvedSrcByHostname.set(hostname, src)

  try {
    localStorage.setItem(`${RESOLVED_FAVICON_CACHE_PREFIX}${hostname}`, JSON.stringify({ src, at: Date.now() }))
  } catch {
    // 内存缓存仍然生效
  }
}

/** 图片加载失败时作废缓存：下一个挂载点会重新探测，而不是一直复用一个坏地址 */
const clearResolvedSrc = (hostname: string): void => {
  resolvedSrcByHostname.delete(hostname)

  try {
    localStorage.removeItem(`${RESOLVED_FAVICON_CACHE_PREFIX}${hostname}`)
  } catch {
    // 忽略
  }
}

/**
 * 依次探测候选地址，返回第一个 HEAD 成功的；全部失败或超时则乐观地返回第一个地址
 * （探测常被防护策略拦掉，而 GET 图片本身仍然可用）。
 */
const probeFaviconSrc = (hostname: string): Promise<string> => {
  const urls = faviconUrlsFor(hostname)

  if (exhaustedHostnames.has(hostname)) return Promise.resolve(urls[0])

  const candidates = urls.filter((url) => !isUrlFailedRecently(url))
  if (candidates.length === 0) {
    exhaustedHostnames.add(hostname)
    return Promise.resolve(urls[0])
  }

  const controller = new AbortController()
  const probes = candidates.map((url) =>
    fetch(url, { method: 'HEAD', signal: controller.signal, credentials: 'omit' }).then((response) => {
      if (response.ok) return url

      // 记录4xx或5xx失败
      if (response.status >= 400) markUrlAsFailed(url)
      throw new Error(`Failed to fetch ${url}`)
    })
  )

  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve(urls[0]), FAVICON_PROBE_TIMEOUT_MS)

    Promise.any(probes)
      .then((url) => resolve(url))
      .catch(() => {
        // 探测全挂（离线、代理拦截等）时仍乐观地返回第一个地址：GET 图片本身可能仍可用
        logger.debug('All favicon sources failed; falling back to the first candidate', { hostname })
        exhaustedHostnames.add(hostname)
        resolve(urls[0])
      })
      .finally(() => {
        clearTimeout(timer)
        controller.abort()
      })
  })
}

const resolveFaviconSrc = (hostname: string): Promise<string> => {
  const cached = readResolvedSrc(hostname)
  if (cached) return Promise.resolve(cached)

  const inflight = inflightByHostname.get(hostname)
  if (inflight) return inflight

  const request = probeFaviconSrc(hostname)
    .then((src) => {
      writeResolvedSrc(hostname, src)
      return src
    })
    .finally(() => {
      inflightByHostname.delete(hostname)
    })

  inflightByHostname.set(hostname, request)
  return request
}

// FallbackFavicon component that tries multiple favicon sources
interface FallbackFaviconProps {
  hostname: string
  alt: string
  /** 在没有可用图片时渲染（加载中、以及所有来源都失败时）；不传则沿用骨架块/首字母方块 */
  fallback?: ReactNode
}

const FallbackFavicon: React.FC<FallbackFaviconProps> = ({ hostname, alt, fallback }) => {
  type FaviconState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; src: string }

  const [faviconState, setFaviconState] = useState<FaviconState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    setFaviconState({ status: 'loading' })

    // 探测结果按 hostname 缓存/去重，因此挂载点卸载后不再中断（否则会把其他挂载点共享的探测一起掐掉）
    void resolveFaviconSrc(hostname).then((src) => {
      if (active) setFaviconState({ status: 'loaded', src })
    })

    return () => {
      active = false
    }
  }, [hostname])

  const handleError = () => {
    if (faviconState.status === 'loaded') {
      // 记录图片加载失败的URL，并作废这个 hostname 的缓存
      markUrlAsFailed(faviconState.src)
      clearResolvedSrc(hostname)
    }
    setFaviconState({ status: 'failed' })
  }

  // Render based on current state
  if (faviconState.status === 'failed') {
    return (
      fallback ?? (
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-primary/15 text-[10px] font-bold text-primary">
          {hostname.charAt(0).toUpperCase()}
        </span>
      )
    )
  }

  if (faviconState.status === 'loaded') {
    return <img src={faviconState.src} alt={alt} onError={handleError} className="h-4 w-4 rounded-[4px] bg-muted" />
  }

  return fallback ?? <span className="inline-block h-4 w-4 rounded-[4px] bg-muted" />
}

export default FallbackFavicon
