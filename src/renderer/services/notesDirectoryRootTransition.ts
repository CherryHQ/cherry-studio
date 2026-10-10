import { randomUUID } from 'node:crypto'

import { cacheService } from '@renderer/data/CacheService'
import { normalizePathValue } from '@renderer/services/NotesTreeService'

export function recordNotesDirectoryRootTransition(from: string, to: string): void {
  cacheService.setShared('notes.directory_root_transition', {
    id: randomUUID(),
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
  const consumedId = cacheService.getPersist('notes.directory_root_transition_consumed_id')
  if (consumedId === pending.id) {
    return null
  }
  cacheService.setPersist('notes.directory_root_transition_consumed_id', pending.id)
  return { from: pending.from, to: pending.to }
}
