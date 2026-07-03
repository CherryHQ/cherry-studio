/**
 * Stored entity-image resolution (avatar / provider logo / mini-app logo).
 *
 * These images live as normalized 128×128 WebP files on disk; each business
 * **owner** (the avatar Preference, the provider / mini-app row) holds the
 * reference. An uploaded image is referenced explicitly as `file:<file-entry-id>`,
 * tagged that way by the owner's main-side command (`profile.set_avatar`,
 * `provider.set_logo`, `mini_app.set_logo`) — which also receives the raw bytes,
 * creates the `file_entry`, and writes the `file_ref` slot. The renderer only
 * sends bytes + intent and resolves the stored ref for display; it never creates
 * `file_entry`s or deals with `sourceType`/`sourceId`/`role`.
 *
 * {@link resolveStoredImageSrc} resolves a `file:<id>` ref → a `file://…/{id}.webp`
 * URL for `<img src>`, passing through every other value form (emoji /
 * `icon:<id>` / preset id, plus any legacy `data:` value) unchanged.
 */

import { STORED_FILE_REF_PREFIX } from '@shared/data/types/file'
import type { FilePath } from '@shared/types/file/common'
import { toFileUrl } from '@shared/utils/file/url'

/**
 * Resolve a stored value to something `<img src>` can render. A `file:<id>` ref
 * becomes a `file://{filesPath}/{id}.webp` URL; every other form (emoji /
 * `icon:<id>` / preset id / a legacy `data:` value / empty) is returned
 * unchanged. `filesPath` is the cached `app.path.files` dir — pass it from
 * `useCache('app.path.files')` so the resolution stays reactive.
 *
 * The URL is built with {@link toFileUrl} so the path is properly encoded
 * (spaces → `%20`, Windows drive letters, `\` → `/`) — a hand-concatenated
 * `file://${filesPath}/…` breaks under macOS `Application Support` or Windows
 * paths that contain spaces, leaving an unnormalized URL the `<img>` can't load.
 */
export function resolveStoredImageSrc(value?: string | null, filesPath?: string): string | undefined {
  if (!value) return undefined
  // `file:<id>` is a stored file-entry ref — distinct from an already-resolved
  // `file://…` URL, which we never re-resolve.
  if (value.startsWith(STORED_FILE_REF_PREFIX) && !value.startsWith('file://')) {
    if (!filesPath) return undefined
    const id = value.slice(STORED_FILE_REF_PREFIX.length)
    return toFileUrl(`${filesPath}/${id}.webp` as FilePath)
  }
  return value
}
