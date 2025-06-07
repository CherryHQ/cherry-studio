import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setAssistantsTabSortType,
  setShowAssistants,
  setShowTopics,
  toggleShowAssistants,
  toggleShowTopics
} from '@renderer/store/settings'
import { AssistantsSortType } from '@renderer/types'

export function useShowAssistants() {
  const showAssistants = useAppSelector((state) => state.settings.showAssistants)
  const dispatch = useAppDispatch()

  return {
    showAssistants,
    setShowAssistants: (show: boolean) => dispatch(setShowAssistants(show)),
    toggleShowAssistants: () => dispatch(toggleShowAssistants())
  }
}

export function useShowTopics() {
  const showTopics = useAppSelector((state) => state.settings.showTopics)
  const dispatch = useAppDispatch()

  return {
    showTopics,
    setShowTopics: (show: boolean) => dispatch(setShowTopics(show)),
    toggleShowTopics: () => dispatch(toggleShowTopics())
  }
}

export function useAssistantsTabSortType() {
  const assistantsTabSortType = useAppSelector((state) => state.settings.assistantsTabSortType)
  const dispatch = useAppDispatch()

  return {
    assistantsTabSortType,
    setAssistantsTabSortType: (sortType: AssistantsSortType) => dispatch(setAssistantsTabSortType(sortType))
  }
}
