import { cacheService } from '@renderer/data/CacheService'
import { normalizePathValue } from '@renderer/services/NotesTreeService'

export function recordNotesDirectoryRootTransition(from: string, to: string): void {
  cacheService.setShared('notes.directory_root_transition', {
    from: normalizePathValue(from),
    to: normalizePathValue(to)
  })
}

export function consumeNotesDirectoryRootTransition(expectedTo: string): { from: string; to: string } | null {
  const pending = cacheService.getShared('notes.directory_root_transition')
  const normalizedTo = normalizePathValue(expectedTo)
  if (!pending || normalizePathValue(pending.to) !== normalizedTo) {
    return null
  }
  cacheService.deleteShared('notes.directory_root_transition')
  return pending
}
