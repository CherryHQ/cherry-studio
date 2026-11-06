export type ChatRouteSearch = {
  assistantId?: string
  topicId?: string
  editAssistantId?: string
  editTab?: string
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const assistantId = typeof search.assistantId === 'string' ? search.assistantId : undefined
  const topicId = typeof search.topicId === 'string' ? search.topicId : undefined

  const editAssistantId =
    typeof search.editAssistantId === 'string' && search.editAssistantId ? search.editAssistantId : undefined
  return {
    assistantId,
    topicId,
    ...(editAssistantId
      ? { editAssistantId, editTab: typeof search.editTab === 'string' ? search.editTab : undefined }
      : {})
  }
}
