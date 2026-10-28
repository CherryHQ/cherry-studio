import { useEffect, useMemo, useState } from 'react'

import { heifErrorKey, type HeifImageSource, isHeifImage, resolveHeifImage } from '@renderer/utils/heif'

export interface HeifImageState {
  url?: string
  loading: boolean
  error?: string
}

export function useHeifRenditions(sources: readonly HeifImageSource[], refreshKey = 0): HeifImageState[] {
  const initial = useMemo(
    () =>
      sources.map((item) => ({
        url: !isHeifImage(item) && typeof item.source === 'string' ? item.source : undefined,
        loading: isHeifImage(item)
      })),
    [sources]
  )
  const [result, setResult] = useState<{ initial: HeifImageState[]; refreshKey: number; states: HeifImageState[] }>()
  useEffect(() => {
    let disposed = false
    const urls: string[] = []
    sources.forEach((item, index) => {
      if (!isHeifImage(item)) return
      void resolveHeifImage(item.source)
        .then((blob) => {
          if (disposed) return
          const url = URL.createObjectURL(blob)
          urls.push(url)
          update({ url, loading: false })
        })
        .catch((error: unknown) => {
          if (!disposed) update({ loading: false, error: heifErrorKey(error) })
        })
      function update(state: HeifImageState) {
        setResult((current) => ({
          initial,
          refreshKey,
          states: (current?.initial === initial && current.refreshKey === refreshKey ? current.states : initial).map(
            (previous, i) => (i === index ? state : previous)
          )
        }))
      }
    })
    return () => {
      disposed = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [sources, initial, refreshKey])
  return result?.initial === initial && result.refreshKey === refreshKey ? result.states : initial
}

export function useHeifRendition(
  source: string | Blob,
  mediaType?: string,
  filename?: string,
  refreshKey = 0
): HeifImageState {
  const sources = useMemo(() => [{ source, mediaType, filename }], [source, mediaType, filename])
  return useHeifRenditions(sources, refreshKey)[0]
}
