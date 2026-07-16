import type { Group } from '@shared/data/types/group'
import { useCallback } from 'react'

import { useGroupMutations, useGroups } from './useGroups'

/**
 * Resolve the legacy import format's single group name for assistants.
 *
 * This stays assistant-specific because Group names are not globally or
 * entity-type scoped unique; other domains must not assume name lookup is
 * unambiguous.
 */
export function useEnsureAssistantGroupByName() {
  const { groups } = useGroups('assistant')
  const { createGroup } = useGroupMutations('assistant')

  const ensureGroup = useCallback(
    async (name: string): Promise<Group | undefined> => {
      const normalizedName = name.trim()
      if (!normalizedName) return undefined

      const existing = groups.find((group) => group.name === normalizedName)
      if (existing) return existing

      return createGroup(normalizedName)
    },
    [createGroup, groups]
  )

  return { ensureGroup }
}
