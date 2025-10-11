import { useAppDispatch } from '@renderer/store'
import { setUnifiedListOrder } from '@renderer/store/assistants'
import { AgentEntity, Assistant } from '@renderer/types'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { UnifiedItem } from './useUnifiedItems'

interface UseUnifiedGroupingOptions {
  unifiedItems: UnifiedItem[]
  assistants: Assistant[]
  agents: AgentEntity[]
  apiServerEnabled: boolean
  agentsLoading: boolean
  agentsError: Error | null
  updateAssistants: (assistants: Assistant[]) => void
}

export const useUnifiedGrouping = (options: UseUnifiedGroupingOptions) => {
  const { unifiedItems, assistants, agents, apiServerEnabled, agentsLoading, agentsError, updateAssistants } = options
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  // Group unified items by tags
  const groupedUnifiedItems = useMemo(() => {
    const groups = new Map<string, UnifiedItem[]>()

    unifiedItems.forEach((item) => {
      if (item.type === 'agent') {
        // Agents go to untagged group
        const groupKey = t('assistants.tags.untagged')
        if (!groups.has(groupKey)) {
          groups.set(groupKey, [])
        }
        groups.get(groupKey)!.push(item)
      } else {
        // Assistants use their tags
        const tags = item.data.tags?.length ? item.data.tags : [t('assistants.tags.untagged')]
        tags.forEach((tag) => {
          if (!groups.has(tag)) {
            groups.set(tag, [])
          }
          groups.get(tag)!.push(item)
        })
      }
    })

    // Sort groups: untagged first, then tagged groups
    const untaggedKey = t('assistants.tags.untagged')
    const sortedGroups = Array.from(groups.entries()).sort(([tagA], [tagB]) => {
      if (tagA === untaggedKey) return -1
      if (tagB === untaggedKey) return 1
      return 0
    })

    return sortedGroups.map(([tag, items]) => ({ tag, items }))
  }, [unifiedItems, t])

  const handleUnifiedGroupReorder = useCallback(
    (tag: string, newGroupList: UnifiedItem[]) => {
      // Extract only assistants from the new list for updating
      const newAssistants = newGroupList.filter((item) => item.type === 'assistant').map((item) => item.data)

      // Update assistants state
      let insertIndex = 0
      const updatedAssistants = assistants.map((a) => {
        const tags = a.tags?.length ? a.tags : [t('assistants.tags.untagged')]
        if (tags.includes(tag)) {
          const replaced = newAssistants[insertIndex]
          insertIndex += 1
          return replaced || a
        }
        return a
      })
      updateAssistants(updatedAssistants)

      // Rebuild unified order and save to Redux
      const newUnifiedItems: UnifiedItem[] = []
      const availableAgents = new Map<string, AgentEntity>()
      const availableAssistants = new Map<string, Assistant>()

      if (apiServerEnabled && !agentsLoading && !agentsError) {
        agents.forEach((agent) => availableAgents.set(agent.id, agent))
      }
      updatedAssistants.forEach((assistant) => availableAssistants.set(assistant.id, assistant))

      // Reconstruct order based on current groupedUnifiedItems structure
      groupedUnifiedItems.forEach((group) => {
        if (group.tag === tag) {
          // Use the new group list for this tag
          newGroupList.forEach((item) => {
            newUnifiedItems.push(item)
            if (item.type === 'agent') {
              availableAgents.delete(item.data.id)
            } else {
              availableAssistants.delete(item.data.id)
            }
          })
        } else {
          // Keep existing order for other tags
          group.items.forEach((item) => {
            newUnifiedItems.push(item)
            if (item.type === 'agent') {
              availableAgents.delete(item.data.id)
            } else {
              availableAssistants.delete(item.data.id)
            }
          })
        }
      })

      // Add any remaining items
      availableAgents.forEach((agent) => newUnifiedItems.push({ type: 'agent', data: agent }))
      availableAssistants.forEach((assistant) => newUnifiedItems.push({ type: 'assistant', data: assistant }))

      // Save to Redux
      const orderToSave = newUnifiedItems.map((item) => ({
        type: item.type,
        id: item.data.id
      }))
      dispatch(setUnifiedListOrder(orderToSave))
    },
    [
      assistants,
      t,
      updateAssistants,
      apiServerEnabled,
      agentsLoading,
      agentsError,
      agents,
      groupedUnifiedItems,
      dispatch
    ]
  )

  return {
    groupedUnifiedItems,
    handleUnifiedGroupReorder
  }
}
