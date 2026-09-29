import { application } from '@application'

export function getLibraryTagResourceIds(kind: 'assistant' | 'agent', tagIds: readonly string[]): string[] {
  const { assignments } = application.get('PreferenceService').get('ui.marketplace.skill_tags')
  const prefix = `${kind}:`
  const selected = new Set(tagIds)
  return Object.entries(assignments)
    .filter(([key, tags]) => key.startsWith(prefix) && tags.some((tag) => selected.has(tag)))
    .map(([key]) => key.slice(prefix.length))
}
