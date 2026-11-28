import { useEffect, useMemo, useState } from 'react'

import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { ipcApi } from '@renderer/ipc'
import type { FileEntryId } from '@shared/data/types/file'
import { toFileUrl } from '@shared/utils/file'

const AVATAR_PATH_BATCH_SIZE = 500

export function useMessageAuthorAvatarSources(
  messages: readonly MessageListItem[],
  listKey = messages[0]?.topicId ?? ''
): ReadonlyMap<string, string> {
  const session = useMemo(
    () => ({
      key: listKey,
      active: true,
      requested: new Set<FileEntryId>(),
      sources: new Map<string, string>()
    }),
    [listKey]
  )
  const [resolved, setResolved] = useState({ session, sources: session.sources })
  const ids = useMemo(
    () => [
      ...new Set(
        messages.flatMap((message) =>
          message.messageSnapshot?.avatarFileId ? [message.messageSnapshot.avatarFileId] : []
        )
      )
    ],
    [messages]
  )

  useEffect(() => {
    session.active = true
    return () => {
      session.active = false
    }
  }, [session])

  useEffect(() => {
    const added = ids.filter((id) => !session.requested.has(id))
    for (let offset = 0; offset < added.length; offset += AVATAR_PATH_BATCH_SIZE) {
      const batch = added.slice(offset, offset + AVATAR_PATH_BATCH_SIZE)
      batch.forEach((id) => session.requested.add(id))
      void ipcApi
        .request('file.batch_get_physical_paths', { ids: batch })
        .then((paths) => {
          if (!session.active) return
          for (const id of batch) {
            const path = paths[id]
            if (path) session.sources.set(id, toFileUrl(path))
          }
          setResolved({ session, sources: new Map(session.sources) })
        })
        .catch(() => {})
    }
  }, [ids, session])

  return resolved.session === session ? resolved.sources : session.sources
}
