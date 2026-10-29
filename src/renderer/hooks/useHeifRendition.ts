import { useEffect, useMemo, useRef, useState } from 'react'

import { heifErrorKey, type HeifImageSource, isHeifImage, resolveHeifImage } from '@renderer/utils/heif'

export interface HeifImageState {
  url?: string
  loading: boolean
  error?: string
}

export function useHeifRenditions(sources: readonly HeifImageSource[], refreshKey = 0): HeifImageState[] {
  const previousSources = useRef(sources)
  if (
    previousSources.current.length !== sources.length ||
    !sources.every((item, index) => {
      const previous = previousSources.current[index]
      return (
        Object.is(item.source, previous.source) &&
        item.mediaType === previous.mediaType &&
        item.filename === previous.filename
      )
    })
  ) {
    previousSources.current = sources
  }
  const stableSources = previousSources.current
  const initial = useMemo(
    () =>
      stableSources.map((item) => ({
        url: !isHeifImage(item) && typeof item.source === 'string' ? item.source : undefined,
        loading: isHeifImage(item)
      })),
    [stableSources]
  )
  const [result, setResult] = useState<{ initial: HeifImageState[]; refreshKey: number; states: HeifImageState[] }>()
  useEffect(() => {
    let disposed = false
    const urls: string[] = []
    stableSources.forEach((item, index) => {
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
  }, [stableSources, initial, refreshKey])
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
