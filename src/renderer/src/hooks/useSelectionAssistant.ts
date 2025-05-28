import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setActionItems,
  setActionWindowOpacity,
  setIsAutoClose,
  setIsAutoPin,
  setIsCompact,
  setIsFollowToolbar,
  setSelectionEnabled,
  setTriggerMode
} from '@renderer/store/selectionStore'
import { ActionItem, TriggerMode } from '@renderer/types/selectionTypes'

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
    setActionWindowOpacity: (opacity: number) => {
      dispatch(setActionWindowOpacity(opacity))
    },
    setActionItems: (items: ActionItem[]) => {
      dispatch(setActionItems(items))
    }
  }
}
