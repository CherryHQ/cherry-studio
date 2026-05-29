/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */

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
