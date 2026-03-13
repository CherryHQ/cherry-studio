import { useAppDispatch } from '@renderer/store'
import { setUnifiedListOrder } from '@renderer/store/assistants'
import type { Assistant } from '@renderer/types'
import { useCallback } from 'react'
import * as tinyPinyin from 'tiny-pinyin'

import type { AssistantListItem } from './useAssistantListItems'

interface UseAssistantListSortingOptions {
  assistantItems: AssistantListItem[]
  updateAssistants: (assistants: Assistant[]) => void
}

export const useAssistantListSorting = (options: UseAssistantListSortingOptions) => {
  const { assistantItems, updateAssistants } = options
  const dispatch = useAppDispatch()

  const sortAssistantItemsByPinyin = useCallback((items: AssistantListItem[], isAscending: boolean) => {
    return [...items].sort((a, b) => {
      const nameA = a.data.name
      const nameB = b.data.name
      const pinyinA = tinyPinyin.convertToPinyin(nameA, '', true)
      const pinyinB = tinyPinyin.convertToPinyin(nameB, '', true)
      return isAscending ? pinyinA.localeCompare(pinyinB) : pinyinB.localeCompare(pinyinA)
    })
  }, [])

  const sortByPinyinAsc = useCallback(() => {
    const sorted = sortAssistantItemsByPinyin(assistantItems, true)
    const orderToSave = sorted.map((item) => ({
      type: item.type,
      id: item.data.id
    }))
    dispatch(setUnifiedListOrder(orderToSave))
    const newAssistants = sorted.map((item) => item.data)
    updateAssistants(newAssistants)
  }, [assistantItems, sortAssistantItemsByPinyin, dispatch, updateAssistants])

  const sortByPinyinDesc = useCallback(() => {
    const sorted = sortAssistantItemsByPinyin(assistantItems, false)
    const orderToSave = sorted.map((item) => ({
      type: item.type,
      id: item.data.id
    }))
    dispatch(setUnifiedListOrder(orderToSave))
    const newAssistants = sorted.map((item) => item.data)
    updateAssistants(newAssistants)
  }, [assistantItems, sortAssistantItemsByPinyin, dispatch, updateAssistants])

  return {
    sortByPinyinAsc,
    sortByPinyinDesc
  }
}
