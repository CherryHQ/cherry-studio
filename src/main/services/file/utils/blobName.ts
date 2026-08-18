/**
 * FileManager-owned projection for internal blob storage.
 *
 * Backup supplies the managed root for the profile it is inspecting, but it
 * must not duplicate how a FileEntry maps to the flat blob filename beneath
 * that root.
 */
export function getExtSuffix(ext: string | null): string {
  return ext ? `.${ext}` : ''
}

export function toInternalBlobFileName(entry: { readonly id: string; readonly ext: string | null }): string {
  return `${entry.id}${getExtSuffix(entry.ext)}`
}
