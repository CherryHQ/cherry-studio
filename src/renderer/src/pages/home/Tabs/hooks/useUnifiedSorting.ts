import { useAppDispatch } from '@renderer/store'
import { setUnifiedListOrder } from '@renderer/store/assistants'
import { Assistant } from '@renderer/types'
import { useCallback } from 'react'
import * as tinyPinyin from 'tiny-pinyin'

import { UnifiedItem } from './useUnifiedItems'

interface UseUnifiedSortingOptions {
  unifiedItems: UnifiedItem[]
  updateAssistants: (assistants: Assistant[]) => void
}

export const useUnifiedSorting = (options: UseUnifiedSortingOptions) => {
  const { unifiedItems, updateAssistants } = options
  const dispatch = useAppDispatch()

  const sortUnifiedItemsByPinyin = useCallback((items: UnifiedItem[], isAscending: boolean) => {
    return [...items].sort((a, b) => {
      const nameA = a.type === 'agent' ? a.data.name || a.data.id : a.data.name
      const nameB = b.type === 'agent' ? b.data.name || b.data.id : b.data.name
      const pinyinA = tinyPinyin.convertToPinyin(nameA, '', true)
      const pinyinB = tinyPinyin.convertToPinyin(nameB, '', true)
      return isAscending ? pinyinA.localeCompare(pinyinB) : pinyinB.localeCompare(pinyinA)
    })
  }, [])

  const sortByPinyinAsc = useCallback(() => {
    const sorted = sortUnifiedItemsByPinyin(unifiedItems, true)
    const orderToSave = sorted.map((item) => ({
      type: item.type,
      id: item.data.id
    }))
    dispatch(setUnifiedListOrder(orderToSave))
    // Also update assistants order
    const newAssistants = sorted.filter((item) => item.type === 'assistant').map((item) => item.data)
    updateAssistants(newAssistants)
  }, [unifiedItems, sortUnifiedItemsByPinyin, dispatch, updateAssistants])

  const sortByPinyinDesc = useCallback(() => {
    const sorted = sortUnifiedItemsByPinyin(unifiedItems, false)
    const orderToSave = sorted.map((item) => ({
      type: item.type,
      id: item.data.id
    }))
    dispatch(setUnifiedListOrder(orderToSave))
    // Also update assistants order
    const newAssistants = sorted.filter((item) => item.type === 'assistant').map((item) => item.data)
    updateAssistants(newAssistants)
  }, [unifiedItems, sortUnifiedItemsByPinyin, dispatch, updateAssistants])

  return {
    sortByPinyinAsc,
    sortByPinyinDesc
  }
}
