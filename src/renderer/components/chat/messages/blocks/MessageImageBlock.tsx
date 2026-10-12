import React, { useEffect, useMemo, useState } from 'react'

import { ipcApi } from '@renderer/ipc'
import type { FileHandle } from '@shared/data/types/file'
import { isFileEntryHandle, toFileUrl } from '@shared/utils/file'

import ImageBlock from './ImageBlock'

/** An image part as the renderer sees it: its file handle plus the stored url as the fallback src. */
export interface MessageImageSource {
  handle?: FileHandle
  url: string
}

interface Props {
  sources: MessageImageSource[]
  isSingle?: boolean
  thumbnail?: boolean
  className?: string
}

function entryIdOf(source: MessageImageSource): string | undefined {
  return source.handle && isFileEntryHandle(source.handle) ? source.handle.entryId : undefined
}

/**
 * Managed images render from their current FileManager location, asked for at mount like
 * `MessageAttachments` does on open; the stored url shows until the lookup lands and stays
 * when the entry is gone.
 */
function useImageSourceUrls(sources: readonly MessageImageSource[]): string[] {
  const key = useMemo(() => [...new Set(sources.map(entryIdOf).filter(Boolean))].join(','), [sources])
  const [resolved, setResolved] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!key) return
    let cancelled = false
    ipcApi
      .request('file.batch_get_physical_paths', { ids: key.split(',') })
      .then((paths) => {
        if (cancelled) return
        const urls: Record<string, string> = {}
        for (const [id, path] of Object.entries(paths)) {
          if (path) urls[id] = toFileUrl(path)
        }
        setResolved((current) => ({ ...current, ...urls }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [key])

  return useMemo(
    () =>
      sources.map((source) => {
        const entryId = entryIdOf(source)
        return (entryId && resolved[entryId]) || source.url
      }),
    [sources, resolved]
  )
}

const MessageImageBlock: React.FC<Props> = ({ sources, isSingle, thumbnail, className }) => {
  const images = useImageSourceUrls(sources)
  return <ImageBlock images={images} isSingle={isSingle} thumbnail={thumbnail} className={className} />
}

export default React.memo(MessageImageBlock)
