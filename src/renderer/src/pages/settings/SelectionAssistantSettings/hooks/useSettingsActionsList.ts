import { DropResult } from '@hello-pangea/dnd'
import { defaultActionItems } from '@renderer/store/selectionStore'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_SEARCH_ENGINES } from '../components/SelectionActionSearchModal'

const MAX_CUSTOM_ITEMS = 8
const MAX_ENABLED_ITEMS = 6

export const useActionItems = (
  initialItems: ActionItem[] | undefined,
  setActionItems: (items: ActionItem[]) => void
) => {
  const { t } = useTranslation()
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [userEditingAction, setUserEditingAction] = useState<ActionItem | null>(null)

  const enabledItems = useMemo(() => initialItems?.filter((item) => item.enabled) ?? [], [initialItems])
  const disabledItems = useMemo(() => initialItems?.filter((item) => !item.enabled) ?? [], [initialItems])
  const customItemsCount = useMemo(() => initialItems?.filter((item) => !item.isBuiltIn).length ?? 0, [initialItems])

  const handleEditActionItem = (item: ActionItem) => {
    if (item.isBuiltIn) {
      if (item.id === 'search') {
        setIsSearchModalOpen(true)
        return
      }
      return
    }
    setUserEditingAction(item)
    setIsUserModalOpen(true)
  }

  const handleAddNewAction = () => {
    if (customItemsCount >= MAX_CUSTOM_ITEMS) return
    setUserEditingAction(null)
    setIsUserModalOpen(true)
  }

  const handleUserModalOk = (actionItem: ActionItem) => {
    if (userEditingAction && initialItems) {
      const updatedItems = initialItems.map((item) => (item.id === userEditingAction.id ? actionItem : item))
      setActionItems(updatedItems)
    } else {
      try {
        const currentItems = initialItems || []
        setActionItems([...currentItems, actionItem])
      } catch (error) {
        console.error('Error adding item:', error)
      }
    }
    setIsUserModalOpen(false)
  }

  const handleSearchModalOk = (searchEngine: string) => {
    if (!initialItems) return
    const updatedItems = initialItems.map((item) => (item.id === 'search' ? { ...item, searchEngine } : item))
    setActionItems(updatedItems)
    setIsSearchModalOpen(false)
  }

  const handleDeleteActionItem = (id: string) => {
    if (!initialItems) return
    window.modal.confirm({
      centered: true,
      content: t('selection.settings.actions.delete_confirm'),
      onOk: () => {
        setActionItems(initialItems.filter((item) => item.id !== id))
      }
    })
  }

  const handleReset = () => {
    if (!initialItems) return
    window.modal.confirm({
      centered: true,
      content: t('selection.settings.actions.reset.confirm'),
      onOk: () => {
        const userItems = initialItems.filter((item) => !item.isBuiltIn).map((item) => ({ ...item, enabled: false }))
        setActionItems([...defaultActionItems, ...userItems])
      }
    })
  }

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !initialItems) return

    const { source, destination } = result

    if (source.droppableId === 'enabled' && destination.droppableId === 'disabled' && enabledItems.length === 1) {
      return
    }

    if (source.droppableId === destination.droppableId) {
      const list = source.droppableId === 'enabled' ? [...enabledItems] : [...disabledItems]
      const [removed] = list.splice(source.index, 1)
      list.splice(destination.index, 0, removed)

      if (source.droppableId === 'enabled') {
        const limitedEnabledItems = list.slice(0, MAX_ENABLED_ITEMS)
        const overflowItems = list.length > MAX_ENABLED_ITEMS ? list.slice(MAX_ENABLED_ITEMS) : []

        const updatedItems = [
          ...limitedEnabledItems.map((item) => ({ ...item, enabled: true })),
          ...disabledItems,
          ...overflowItems.map((item) => ({ ...item, enabled: false }))
        ]

        setActionItems(updatedItems)
      } else {
        const updatedItems = [...enabledItems, ...list]
        setActionItems(updatedItems)
      }
      return
    }

    const sourceList = source.droppableId === 'enabled' ? [...enabledItems] : [...disabledItems]
    const destList = destination.droppableId === 'enabled' ? [...enabledItems] : [...disabledItems]

    const [removed] = sourceList.splice(source.index, 1)
    const updatedItem = { ...removed, enabled: destination.droppableId === 'enabled' }

    const filteredDestList = destList.filter((item) => item.id !== updatedItem.id)
    filteredDestList.splice(destination.index, 0, updatedItem)

    let newEnabledItems = destination.droppableId === 'enabled' ? filteredDestList : sourceList
    let newDisabledItems = destination.droppableId === 'disabled' ? filteredDestList : sourceList

    if (newEnabledItems.length > MAX_ENABLED_ITEMS) {
      const overflowItems = newEnabledItems.slice(MAX_ENABLED_ITEMS).map((item) => ({ ...item, enabled: false }))
      newEnabledItems = newEnabledItems.slice(0, MAX_ENABLED_ITEMS)
      newDisabledItems = [...newDisabledItems, ...overflowItems]
    }

    const updatedItems = [
      ...newEnabledItems.map((item) => ({ ...item, enabled: true })),
      ...newDisabledItems.map((item) => ({ ...item, enabled: false }))
    ]

    setActionItems(updatedItems)
  }

  const getSearchEngineInfo = (searchEngine: string) => {
    if (!searchEngine) return null
    const [engine] = searchEngine.split('|')
    const defaultEngine = DEFAULT_SEARCH_ENGINES.find((e) => e.value === engine)
    if (defaultEngine) {
      return { icon: defaultEngine.icon, name: defaultEngine.label }
    }
    const customEngine = DEFAULT_SEARCH_ENGINES.find((e) => e.value === 'custom')
    return { icon: customEngine?.icon, name: engine }
  }

  return {
    enabledItems,
    disabledItems,
    customItemsCount,
    isUserModalOpen,
    isSearchModalOpen,
    userEditingAction,
    setIsUserModalOpen,
    setIsSearchModalOpen,
    setUserEditingAction,
    handleEditActionItem,
    handleAddNewAction,
    handleUserModalOk,
    handleSearchModalOk,
    handleDeleteActionItem,
    handleReset,
    onDragEnd,
    getSearchEngineInfo,
    MAX_CUSTOM_ITEMS,
    MAX_ENABLED_ITEMS
  }
}
