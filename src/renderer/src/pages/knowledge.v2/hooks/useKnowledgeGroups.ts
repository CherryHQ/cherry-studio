import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { Group } from '@shared/data/types/group'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useKnowledgeGroups')

export const useKnowledgeGroups = () => {
  const { data, isLoading, error, refetch } = useQuery('/groups', {
    query: { entityType: 'knowledge' }
  })

  const groups = useMemo(() => data ?? [], [data])

  return {
    groups,
    isLoading,
    error,
    refetch
  }
}

export const useCreateKnowledgeGroup = () => {
  const {
    trigger: createTrigger,
    isLoading: isCreating,
    error: createError
  } = useMutation('POST', '/groups', {
    refresh: ['/groups']
  })

  const createGroup = useCallback(
    async (name: string): Promise<Group> => {
      const normalizedName = name.trim()

      if (!normalizedName) {
        throw new Error('Knowledge group name is required')
      }

      try {
        return await createTrigger({
          body: {
            entityType: 'knowledge',
            name: normalizedName
          }
        })
      } catch (error) {
        logger.error('Failed to create knowledge group', {
          name: normalizedName,
          error
        })
        throw error
      }
    },
    [createTrigger]
  )

  return {
    createGroup,
    isCreating,
    createError
  }
}
