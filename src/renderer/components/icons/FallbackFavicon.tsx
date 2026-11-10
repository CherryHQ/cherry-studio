import { type ReactNode, useEffect, useState } from 'react'

import { faviconService } from '@renderer/services/FaviconService'

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
    void faviconService.resolve(hostname).then((src) => {
      if (active) setFaviconState({ status: 'loaded', src })
    })

    return () => {
      active = false
    }
  }, [hostname])

  const handleError = () => {
    if (faviconState.status === 'loaded') {
      // 记录图片加载失败的URL，并作废这个 hostname 的缓存
      faviconService.invalidate(hostname, faviconState.src)
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
