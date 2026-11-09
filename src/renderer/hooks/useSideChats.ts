import { useSyncExternalStore } from 'react'

import { ipcApi } from '@renderer/ipc'
import { SideChatState } from '@renderer/services/SideChatState'
import type { SideChatView } from '@shared/ipc/schemas/sideChat'

const state = new SideChatState()
let subscribed = false

export function connectSideChats() {
  if (subscribed) return
  ipcApi.on('side_chat.changed', ({ topicId, revision, view }) => state.apply(topicId, revision, view))
  subscribed = true
}

export function acceptSideChat(view: SideChatView) {
  state.apply(view.topicId, view.revision, view)
  return view
}

export function useSideChats(sourceTopicId?: string) {
  const views = useSyncExternalStore(state.subscribe, state.getSnapshot)
  return sourceTopicId ? views.filter((view) => view.sourceTopicId === sourceTopicId) : views
}

export function useSideChatDraft(topicId: string) {
  const draft = useSyncExternalStore(state.subscribe, () => state.getDraft(topicId))
  return [draft, (text: string) => state.setDraft(topicId, text)] as const
}

export const clearSubmittedSideChatDraft = (topicId: string, submitted: string) =>
  state.clearSubmittedDraft(topicId, submitted)
