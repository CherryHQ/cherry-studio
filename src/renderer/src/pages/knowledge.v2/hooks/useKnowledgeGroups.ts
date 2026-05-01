import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { UpdateGroupDto } from '@shared/data/api/schemas/groups'
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

export const useUpdateKnowledgeGroup = () => {
  const {
    trigger: updateTrigger,
    isLoading: isUpdating,
    error: updateError
  } = useMutation('PATCH', '/groups/:id', {
    refresh: ['/groups']
  })

  const updateGroup = useCallback(
    async (groupId: string, updates: UpdateGroupDto) => {
      try {
        return await updateTrigger({
          params: { id: groupId },
          body: updates
        })
      } catch (error) {
        logger.error('Failed to update knowledge group', {
          groupId,
          updates,
          error
        })
        throw error
      }
    },
    [updateTrigger]
  )

  return {
    updateGroup,
    isUpdating,
    updateError
  }
}

export const useDeleteKnowledgeGroup = () => {
  const {
    trigger: deleteTrigger,
    isLoading: isDeleting,
    error: deleteError
  } = useMutation('DELETE', '/groups/:id', {
    refresh: ['/groups', '/knowledge-bases']
  })

  const deleteGroup = useCallback(
    async (groupId: string) => {
      try {
        return await deleteTrigger({
          params: { id: groupId }
        })
      } catch (error) {
        logger.error('Failed to delete knowledge group', {
          groupId,
          error
        })
        throw error
      }
    },
    [deleteTrigger]
  )

  return {
    deleteGroup,
    isDeleting,
    deleteError
  }
}
