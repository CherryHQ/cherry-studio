import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from '@renderer/store'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setUnifiedListOrder } from '@renderer/store/assistants'
import type { Assistant } from '@renderer/types'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { AssistantListItem } from './useAssistantListItems'

interface UseAssistantListGroupingOptions {
  assistantItems: AssistantListItem[]
  assistants: Assistant[]
  updateAssistants: (assistants: Assistant[]) => void
}

export const useAssistantListGrouping = (options: UseAssistantListGroupingOptions) => {
  const { assistantItems, assistants, updateAssistants } = options
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  // Selector to get tagsOrder from Redux store
  const selectTagsOrder = useMemo(
    () => createSelector([(state: RootState) => state.assistants], (assistants) => assistants.tagsOrder ?? []),
    []
  )
  const savedTagsOrder = useAppSelector(selectTagsOrder)

  // Group assistant items by tags
  const groupedAssistantItems = useMemo(() => {
    const groups = new Map<string, AssistantListItem[]>()

    assistantItems.forEach((item) => {
      const tags = item.data.tags?.length ? item.data.tags : [t('assistants.tags.untagged')]
      tags.forEach((tag) => {
        if (!groups.has(tag)) {
          groups.set(tag, [])
        }
        groups.get(tag)!.push(item)
      })
    })

    // Sort groups: untagged first, then by savedTagsOrder
    const untaggedKey = t('assistants.tags.untagged')
    const sortedGroups = Array.from(groups.entries()).sort(([tagA], [tagB]) => {
      if (tagA === untaggedKey) return -1
      if (tagB === untaggedKey) return 1

      if (savedTagsOrder.length > 0) {
        const indexA = savedTagsOrder.indexOf(tagA)
        const indexB = savedTagsOrder.indexOf(tagB)

        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB
        }

        if (indexA !== -1) return -1

        if (indexB !== -1) return 1
      }

      return 0
    })

    return sortedGroups.map(([tag, items]) => ({ tag, items }))
  }, [assistantItems, t, savedTagsOrder])

  const handleAssistantGroupReorder = useCallback(
    (tag: string, newGroupList: AssistantListItem[]) => {
      // Extract only assistants from the new list for updating
      const newAssistants = newGroupList.map((item) => item.data)

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

      // Rebuild order and save to Redux
      const newItems: AssistantListItem[] = []
      const availableAssistants = new Map<string, Assistant>()

      updatedAssistants.forEach((assistant) => availableAssistants.set(assistant.id, assistant))

      // Reconstruct order based on current groupedAssistantItems structure
      groupedAssistantItems.forEach((group) => {
        if (group.tag === tag) {
          newGroupList.forEach((item) => {
            newItems.push(item)
            availableAssistants.delete(item.data.id)
          })
        } else {
          group.items.forEach((item) => {
            newItems.push(item)
            availableAssistants.delete(item.data.id)
          })
        }
      })

      // Add any remaining items
      availableAssistants.forEach((assistant) => newItems.push({ type: 'assistant', data: assistant }))

      // Save to Redux
      const orderToSave = newItems.map((item) => ({
        type: item.type,
        id: item.data.id
      }))
      dispatch(setUnifiedListOrder(orderToSave))
    },
    [assistants, t, updateAssistants, groupedAssistantItems, dispatch]
  )

  return {
    groupedAssistantItems,
    handleAssistantGroupReorder
  }
}
