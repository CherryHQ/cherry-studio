import { cacheService } from '@renderer/data/CacheService'
import { normalizePathValue } from '@renderer/services/NotesTreeService'

function readRootChain(): string[] | null {
  const pending = cacheService.getShared('notes.directory_root_transition')
  return pending?.roots.length ? pending.roots.map(normalizePathValue) : null
}

export function recordNotesDirectoryRootTransition(from: string, to: string): void {
  const previous = readRootChain()
  const normalizedFrom = normalizePathValue(from)
  const chain = previous && previous[previous.length - 1] === normalizedFrom ? previous : [normalizedFrom]
  cacheService.setShared('notes.directory_root_transition', {
    roots: [...chain, normalizePathValue(to)]
  })
}

/**
 * Non-destructive read — each renderer applies the transition locally. The
 * chain keeps every root the library has occupied, so a selection still
 * pointing at any of them resolves to the live one after several migrations.
 */
export function consumeNotesDirectoryRootTransition(expectedTo: string): string[] | null {
  const chain = readRootChain()
  if (!chain || chain[chain.length - 1] !== normalizePathValue(expectedTo)) {
    return null
  }
  return chain
}
