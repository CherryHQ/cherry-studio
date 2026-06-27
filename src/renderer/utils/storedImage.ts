/**
 * Stored entity-image display helpers (avatar / provider logo / mini-app logo).
 *
 * These images live as normalized 128×128 WebP files on disk; each business
 * **owner** (the avatar Preference, the provider / mini-app row) holds the
 * file-entry id directly. Uploads no longer go through a generic file route —
 * each owner's own API (e.g. `profile.set_avatar`, the provider / mini-app
 * DataApi mutations) receives the pre-encoded WebP bytes and writes the
 * reference itself. This module only resolves a stored id → a
 * `file://…/{id}.webp` URL for `<img src>` display, passing through every other
 * value form (emoji / `icon:<id>` / preset id / `http(s)` / `data:`) unchanged.
 */

/** file_entry ids are UUIDs (v7); anything else is an emoji / icon ref / url / preset id. */
const FILE_ENTRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when `value` is a stored entity-image reference (a file-entry id). */
export function isStoredImageId(value?: string | null): value is string {
  return !!value && FILE_ENTRY_ID_RE.test(value)
}

/**
 * Resolve a stored value to something `<img src>` can render. A file-entry id
 * becomes a `file://{filesPath}/{id}.webp` URL; every other form (emoji /
 * `icon:<id>` / preset id / remote URL / data URL / empty) is returned
 * unchanged. `filesPath` is the cached `app.path.files` dir — pass it from
 * `useCache('app.path.files')` so the resolution stays reactive.
 */
export function resolveStoredImageSrc(value?: string | null, filesPath?: string): string | undefined {
  if (!value) return undefined
  if (!isStoredImageId(value)) return value
  if (!filesPath) return undefined
  return `file://${filesPath}/${value}.webp`
}
