import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('LibraryTags')

export function getLibraryTagResourceIds(kind: 'assistant' | 'agent', tagIds: readonly string[]): string[] {
  const { assignments } = application.get('PreferenceService').get('ui.marketplace.skill_tags')
  const prefix = `${kind}:`
  const selected = new Set(tagIds)
  return Object.entries(assignments)
    .filter(([key, tags]) => key.startsWith(prefix) && tags.some((tag) => selected.has(tag)))
    .map(([key]) => key.slice(prefix.length))
}

/** Call after a permanent deletion commits; recoverable Recycle Bin entries retain their tags. */
export async function removeLibraryTagAssignments(resourceKeys: readonly string[]): Promise<void> {
  if (!resourceKeys.length) return
  try {
    const preferences = application.get('PreferenceService')
    const current = preferences.get('ui.marketplace.skill_tags')
    if (!resourceKeys.some((key) => Object.hasOwn(current.assignments, key))) return
    const assignments = { ...current.assignments }
    for (const key of resourceKeys) delete assignments[key]
    await preferences.set('ui.marketplace.skill_tags', { ...current, assignments })
  } catch (error) {
    // The resource is already gone; failed ancillary cleanup must not report the deletion as failed.
    logger.warn('Failed to remove deleted resource tag assignments', { resourceKeys, error })
  }
}
