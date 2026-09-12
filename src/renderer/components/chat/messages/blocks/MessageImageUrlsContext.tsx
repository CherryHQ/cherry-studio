import type { ReactNode } from 'react'
import { createContext, use, useEffect, useMemo, useState } from 'react'

import { ipcApi } from '@renderer/ipc'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { toFileUrl } from '@shared/utils/file'

const MessageImageUrlsContext = createContext<ReadonlyMap<string, string> | null>(null)
const EMPTY_RESOLVED_IMAGE_URLS: ReadonlyMap<string, string> = new Map()

function managedImageEntryIds(parts: readonly CherryMessagePart[]): string[] {
  const ids = new Set<string>()
  for (const part of parts) {
    if (part.type !== 'file' || !part.mediaType.startsWith('image/')) continue
    const entryId = readCherryMeta(part)?.fileEntryId
    if (entryId) ids.add(entryId)
  }
  return [...ids]
}

export function MessageImageUrlsProvider({ parts, children }: { parts: CherryMessagePart[]; children: ReactNode }) {
  const entryIds = useMemo(() => managedImageEntryIds(parts), [parts])
  const entryIdsKey = entryIds.join('\0')
  const [resolved, setResolved] = useState<{ key: string; urls: ReadonlyMap<string, string> }>({
    key: '',
    urls: EMPTY_RESOLVED_IMAGE_URLS
  })

  useEffect(() => {
    if (entryIds.length === 0) return

    let active = true
    void ipcApi
      .request('file.batch_get_physical_paths', { ids: entryIds })
      .then((paths) => {
        if (!active) return
        const urls = new Map<string, string>()
        for (const entryId of entryIds) {
          const path = paths[entryId]
          if (path) urls.set(entryId, toFileUrl(path))
        }
        setResolved({ key: entryIdsKey, urls })
      })
      .catch(() => {
        if (active) setResolved({ key: entryIdsKey, urls: EMPTY_RESOLVED_IMAGE_URLS })
      })

    return () => {
      active = false
    }
  }, [entryIds, entryIdsKey])

  const urls = entryIds.length === 0 || resolved.key !== entryIdsKey ? EMPTY_RESOLVED_IMAGE_URLS : resolved.urls
  return <MessageImageUrlsContext value={urls}>{children}</MessageImageUrlsContext>
}

/**
 * Replace managed image URLs with current FileManager-backed locations for rendering only.
 * The stored message parts remain unchanged, and unmanaged external/data URLs pass through.
 */
export function useResolvedMessageImageParts(parts: CherryMessagePart[]): CherryMessagePart[] {
  const urls = use(MessageImageUrlsContext)

  return useMemo(() => {
    if (urls === null) return parts

    let changed = false
    const resolvedParts = parts.map((part) => {
      if (part.type !== 'file' || !part.mediaType.startsWith('image/')) return part
      const entryId = readCherryMeta(part)?.fileEntryId
      if (!entryId) return part

      const url = urls.get(entryId) ?? ''
      if (part.url === url) return part
      changed = true
      return { ...part, url }
    })
    return changed ? resolvedParts : parts
  }, [parts, urls])
}
