import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setUnifiedListOrder } from '@renderer/store/assistants'
import type { Assistant } from '@renderer/types'
import { useCallback, useMemo } from 'react'

export type AssistantListItem = { type: 'assistant'; data: Assistant }

interface UseAssistantListItemsOptions {
  assistants: Assistant[]
  updateAssistants: (assistants: Assistant[]) => void
}

export const useAssistantListItems = (options: UseAssistantListItemsOptions) => {
  const { assistants, updateAssistants } = options
  const dispatch = useAppDispatch()
  const assistantListOrder = useAppSelector((state) => state.assistants.unifiedListOrder || [])

  // Create assistant items list with saved order
  const assistantItems = useMemo(() => {
    const items: AssistantListItem[] = []
    const availableAssistants = new Map<string, Assistant>()

    assistants.forEach((assistant) => availableAssistants.set(assistant.id, assistant))

    // Apply saved order (filter out agent entries from legacy data)
    assistantListOrder.forEach((item) => {
      if (item.type === 'assistant' && availableAssistants.has(item.id)) {
        items.push({ type: 'assistant', data: availableAssistants.get(item.id)! })
        availableAssistants.delete(item.id)
      }
    })

    // Add new items (not in saved order) to the beginning
    const newItems: AssistantListItem[] = []
    availableAssistants.forEach((assistant) => newItems.push({ type: 'assistant', data: assistant }))
    items.unshift(...newItems)

    return items
  }, [assistants, assistantListOrder])

  const handleAssistantListReorder = useCallback(
    (newList: AssistantListItem[]) => {
      // Save the order to Redux
      const orderToSave = newList.map((item) => ({
        type: item.type,
        id: item.data.id
      }))
      dispatch(setUnifiedListOrder(orderToSave))

      // Extract and update assistants order
      const newAssistants = newList.filter((item) => item.type === 'assistant').map((item) => item.data)
      updateAssistants(newAssistants)
    },
    [dispatch, updateAssistants]
  )

  return {
    assistantItems,
    handleAssistantListReorder
  }
}
