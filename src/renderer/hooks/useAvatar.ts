import { usePreference } from '@data/hooks/usePreference'
import UserAvatar from '@renderer/assets/images/avatar.png'
import { ipcApi } from '@renderer/ipc'
import type { FileEntryId } from '@shared/data/types/file'
import { STORED_FILE_REF_PREFIX } from '@shared/data/types/file'
import type { FilePath } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'
import { useEffect, useState } from 'react'

/** The `file_entry` id of an uploaded avatar (`file:<id>`), or undefined for emoji / default. */
function avatarStoredId(avatar: string | undefined): FileEntryId | undefined {
  if (!avatar || !avatar.startsWith(STORED_FILE_REF_PREFIX) || avatar.startsWith('file://')) return undefined
  return avatar.slice(STORED_FILE_REF_PREFIX.length)
}

/**
 * The user avatar as a render-ready value: a `file://` URL for an uploaded
 * image, the emoji glyph verbatim, or the bundled default.
 *
 * An uploaded avatar is stored in the `app.user.avatar` preference as a
 * `file:<id>` ref. Unlike a provider / mini-app logo (resolved main-side onto
 * the DTO's `logoSrc`), the avatar is a preference with no DTO, so its id is
 * resolved here through the file IPC — never by reconstructing a disk path,
 * which would break in windows that don't mount `app.path.files`.
 */
export default function useAvatar(): string {
  const [avatar] = usePreference('app.user.avatar')
  const [resolvedSrc, setResolvedSrc] = useState<string>()

  const storedId = avatarStoredId(avatar)
  useEffect(() => {
    if (!storedId) {
      setResolvedSrc(undefined)
      return
    }
    let active = true
    ipcApi
      .request('file.batch_get_physical_paths', { ids: [storedId] })
      .then((paths) => {
        if (!active) return
        const path = paths[storedId]
        setResolvedSrc(path ? toFileUrl(path as FilePath) : undefined)
      })
      .catch(() => {
        if (active) setResolvedSrc(undefined)
      })
    return () => {
      active = false
    }
  }, [storedId])

  if (storedId) return resolvedSrc ?? UserAvatar
  return avatar || UserAvatar
}
