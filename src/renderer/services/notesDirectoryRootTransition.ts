import { randomUUID } from 'node:crypto'

import { cacheService } from '@renderer/data/CacheService'
import { normalizePathValue } from '@renderer/services/NotesTreeService'

export function recordNotesDirectoryRootTransition(from: string, to: string): void {
  const normalizedFrom = normalizePathValue(from)
  const normalizedTo = normalizePathValue(to)
  const pending = cacheService.getShared('notes.directory_root_transition')
  const chainedFrom =
    pending && normalizePathValue(pending.to) === normalizedFrom ? normalizePathValue(pending.from) : normalizedFrom
  cacheService.setShared('notes.directory_root_transition', {
    id: randomUUID(),
    from: chainedFrom,
    to: normalizedTo
  })
}

/** Non-destructive read — each renderer applies the transition locally. */
export function consumeNotesDirectoryRootTransition(expectedTo: string): { from: string; to: string } | null {
  const pending = cacheService.getShared('notes.directory_root_transition')
  const normalizedTo = normalizePathValue(expectedTo)
  if (!pending || normalizePathValue(pending.to) !== normalizedTo) {
    return null
  }
  return { from: pending.from, to: pending.to }
}
