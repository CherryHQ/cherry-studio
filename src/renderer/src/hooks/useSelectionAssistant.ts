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

export function useSelectionAssistant() {
  const dispatch = useAppDispatch()
  const selectionStore = useAppSelector((state) => state.selectionStore)

  return {
    ...selectionStore,
    setSelectionEnabled: (enabled: boolean) => {
      dispatch(setSelectionEnabled(enabled))
      window.api.selection.setEnabled(enabled)
    },
    setTriggerMode: (mode: TriggerMode) => {
      dispatch(setTriggerMode(mode))
      window.api.selection.setTriggerMode(mode)
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
      window.api.selection.setFollowToolbar(isFollowToolbar)
    },
    setIsRemeberWinSize: (isRemeberWinSize: boolean) => {
      dispatch(setIsRemeberWinSize(isRemeberWinSize))
      window.api.selection.setRemeberWinSize(isRemeberWinSize)
    },
    setFilterMode: (mode: FilterMode) => {
      dispatch(setFilterMode(mode))
      window.api.selection.setFilterMode(mode)
    },
    setFilterList: (list: string[]) => {
      dispatch(setFilterList(list))
      window.api.selection.setFilterList(list)
    },
    setActionWindowOpacity: (opacity: number) => {
      dispatch(setActionWindowOpacity(opacity))
    },
    setActionItems: (items: ActionItem[]) => {
      dispatch(setActionItems(items))
    }
  }
}
