import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { WebUiConversationSummary, WebUiMessageSnapshot } from '../types/api'

export const useWebUiChatStore = defineStore('webui-chat', () => {
  const conversations = ref<readonly WebUiConversationSummary[]>([])
  const messages = ref<readonly WebUiMessageSnapshot[]>([])
  const selectedConversationId = ref<string>()
  const activeRunConversationId = ref<string>()

  return {
    activeRunConversationId,
    conversations,
    messages,
    selectedConversationId
  }
})
