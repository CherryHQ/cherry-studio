//FIXME @deprecated this file will be removed after data refactor
import { usePreference } from '@data/hooks/usePreference'
import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import store from '@renderer/store'

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

export function getStoreProviders() {
  return store.getState().llm.providers.concat([CHERRYAI_PROVIDER])
}
