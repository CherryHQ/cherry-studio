import PQueue from 'p-queue'
import { useEffect, useMemo, useRef, useState } from 'react'

import { heifErrorKey, type HeifImageSource, isHeifImage, resolveHeifImage } from '@renderer/utils/heif'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'

// Leave room in the service queue for sends.
const HEIF_CONCURRENCY = 4
const HEIF_BUSY_RETRIES = 5
const HEIF_BUSY_BACKOFF_MS = 50
const HEIF_PREVIEW_DEADLINE_MS = 30_000
const queue = new PQueue({ concurrency: HEIF_CONCURRENCY })

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
    const retryDelays = new Map<ReturnType<typeof setTimeout>, () => void>()
    const cancellations = new Set<() => void>()
    stableSources.forEach((item, index) => {
      if (!isHeifImage(item)) return
      void queue
        .add(async () => {
          if (disposed) return
          let finished = false
          let timer: ReturnType<typeof setTimeout>
          let cancel: () => void
          const deadline = new Promise<undefined>((resolve, reject) => {
            cancel = () => resolve(undefined)
            cancellations.add(cancel)
            timer = setTimeout(() => reject(new IpcError(fileErrorCodes.HEIF_TIMEOUT)), HEIF_PREVIEW_DEADLINE_MS)
          })
          const convert = async () => {
            for (let retry = 0; !disposed && !finished; retry++) {
              try {
                return await resolveHeifImage(item.source)
              } catch (error) {
                if (disposed || finished) return
                if (heifErrorKey(error) !== 'error.heif_detail_busy' || retry >= HEIF_BUSY_RETRIES) throw error
                await new Promise<void>((resolve) => {
                  const timer = setTimeout(
                    () => {
                      retryDelays.delete(timer)
                      resolve()
                    },
                    Math.min(HEIF_BUSY_BACKOFF_MS * 2 ** retry, 400)
                  )
                  retryDelays.set(timer, resolve)
                })
              }
            }
            return undefined
          }
          try {
            return await Promise.race([convert(), deadline])
          } finally {
            finished = true
            clearTimeout(timer!)
            cancellations.delete(cancel!)
          }
        })
        .then((blob) => {
          if (disposed || !blob) return
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
      cancellations.forEach((cancel) => cancel())
      retryDelays.forEach((resolve, timer) => {
        clearTimeout(timer)
        resolve()
      })
      retryDelays.clear()
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
