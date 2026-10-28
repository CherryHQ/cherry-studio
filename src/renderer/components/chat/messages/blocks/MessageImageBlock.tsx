import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useHeifRenditions } from '@renderer/hooks/useHeifRendition'
import { ipcApi } from '@renderer/ipc'
import type { FileHandle } from '@shared/data/types/file'
import { isFileEntryHandle, toFileUrl } from '@shared/utils/file'

import ImageBlock from './ImageBlock'

/** An image part as the renderer sees it: its file handle plus the stored url as the fallback src. */
export interface MessageImageSource {
  handle?: FileHandle
  url: string
  mediaType?: string
  filename?: string
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
  const { t } = useTranslation()
  const urls = useImageSourceUrls(sources)
  const inputs = useMemo(
    () => sources.map((item, index) => ({ source: urls[index], mediaType: item.mediaType, filename: item.filename })),
    [sources, urls]
  )
  const states = useHeifRenditions(inputs)
  const gallery = states.flatMap((state, index) =>
    state.url ? [{ id: `message-image-${index}`, src: state.url }] : []
  )
  return (
    <>
      {states.map((state, index) =>
        state.error ? (
          <div role="alert" key={index}>
            {t(state.error)}
          </div>
        ) : state.loading ? (
          <div role="status" key={index}>
            {t('file_preview.loading')}
          </div>
        ) : null
      )}
      <ImageBlock images={gallery} isSingle={isSingle} thumbnail={thumbnail} className={className} />
    </>
  )
}

export default React.memo(MessageImageBlock)
