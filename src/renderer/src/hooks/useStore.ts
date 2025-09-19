//FIXME 这个文件有必要存在吗？ fullex@data refactor

import { usePreference } from '@data/hooks/usePreference'

export function useShowAssistants() {
  const [showAssistants, setShowAssistants] = usePreference('assistant.tab.show')

  return {
    showAssistants,
    setShowAssistants,
    toggleShowAssistants: () => setShowAssistants(!showAssistants)
  }
}

export function useShowTopics() {
  const [showTopics, setShowTopics] = usePreference('topic.tab.show')

  return {
    showTopics,
    setShowTopics,
    toggleShowTopics: () => setShowTopics(!showTopics)
  }
}

export function useAssistantsTabSortType() {
  const [assistantsTabSortType, setAssistantsTabSortType] = usePreference('assistant.tab.sort_type')

  return {
    assistantsTabSortType,
    setAssistantsTabSortType
  }
}
