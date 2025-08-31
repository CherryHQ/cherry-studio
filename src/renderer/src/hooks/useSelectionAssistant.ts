import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setActionItems,
  setActionWindowOpacity,
  setFilterList,
  setFilterMode,
  setIsAutoClose,
  setIsAutoPin,
  setIsCompact,
  setIsFollowToolbar,
  setIsRemeberWinSize,
  setSelectionEnabled,
  setTriggerMode
} from '@renderer/store/selectionStore'
import { ActionItem, FilterMode, TriggerMode } from '@renderer/types/selectionTypes'
import { useEffect } from 'react'

export function useSelectionAssistant() {
  const dispatch = useAppDispatch()
  const selectionStore = useAppSelector((state) => state.selectionStore)

  // 自动同步设置到main，不依赖set函数的行为
  useEffect(() => {
    window.api.selection.setEnabled(selectionStore.selectionEnabled)
  }, [selectionStore.selectionEnabled])

  useEffect(() => {
    window.api.selection.setTriggerMode(selectionStore.triggerMode)
  }, [selectionStore.triggerMode])

  useEffect(() => {
    window.api.selection.setFollowToolbar(selectionStore.isFollowToolbar)
  }, [selectionStore.isFollowToolbar])

  useEffect(() => {
    window.api.selection.setRemeberWinSize(selectionStore.isRemeberWinSize)
  }, [selectionStore.isRemeberWinSize])

  useEffect(() => {
    window.api.selection.setFilterMode(selectionStore.filterMode)
  }, [selectionStore.filterMode])

  useEffect(() => {
    window.api.selection.setFilterList(selectionStore.filterList)
  }, [selectionStore.filterList])

  return {
    ...selectionStore,
    setSelectionEnabled: (enabled: boolean) => {
      dispatch(setSelectionEnabled(enabled))
    },
    setTriggerMode: (mode: TriggerMode) => {
      dispatch(setTriggerMode(mode))
    },
    setIsCompact: (isCompact: boolean) => {
      dispatch(setIsCompact(isCompact))
    },
    setIsAutoClose: (isAutoClose: boolean) => {
      dispatch(setIsAutoClose(isAutoClose))
    },
    setIsAutoPin: (isAutoPin: boolean) => {
      dispatch(setIsAutoPin(isAutoPin))
    },
    setIsFollowToolbar: (isFollowToolbar: boolean) => {
      dispatch(setIsFollowToolbar(isFollowToolbar))
    },
    setIsRemeberWinSize: (isRemeberWinSize: boolean) => {
      dispatch(setIsRemeberWinSize(isRemeberWinSize))
    },
    setFilterMode: (mode: FilterMode) => {
      dispatch(setFilterMode(mode))
    },
    setFilterList: (list: string[]) => {
      dispatch(setFilterList(list))
    },
    setActionWindowOpacity: (opacity: number) => {
      dispatch(setActionWindowOpacity(opacity))
    },
    setActionItems: (items: ActionItem[]) => {
      dispatch(setActionItems(items))
    }
  }
}
