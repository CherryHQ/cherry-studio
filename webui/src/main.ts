import { computed, createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createPinia, storeToRefs } from 'pinia'

import 'highlight.js/styles/github.css'

import { createWebUiHttpClient } from './service/httpClient'
import { createWebUiSseClient } from './service/sseClient'
import { useWebUiChatStore } from './stores/chatStore'
import type {
  WebUiAgentSessionMessageEntity,
  WebUiAgentSessionEntity,
  WebUiAgentEntity,
  WebUiConversationSummary,
  WebUiChunkPayload,
  WebUiCursorResponse,
  WebUiHealthResponse,
  WebUiMessageSnapshot,
  WebUiOffsetResponse
} from './types/api'
import { renderMarkdown } from './utils/renderMarkdown'

type WebuiStatus = {
  readonly label: string
  readonly value: string
}

const toErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : 'Unable to reach the desktop bridge'
}

const toConversationSummary = (session: WebUiAgentSessionEntity): WebUiConversationSummary => ({
  id: session.id,
  title: session.name || 'Untitled session',
  updatedAt: session.updatedAt,
  workspaceLabel: session.workspace?.name ?? session.workspace?.path
})

const toMessageSnapshot = (message: WebUiAgentSessionMessageEntity): WebUiMessageSnapshot => {
  const parts = message.data.parts ?? []
  const content = parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
  const reasoning = parts
    .filter((part) => part.type === 'reasoning' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')

  return {
    id: message.id,
    conversationId: message.sessionId,
    role: message.role,
    content: content || message.searchableText || '',
    ...(reasoning ? { reasoning } : {}),
    createdAt: message.createdAt
  }
}

const App = defineComponent({
  name: 'CherryStudioWebuiShell',
  setup() {
    const httpClient = createWebUiHttpClient()
    const sseClient = createWebUiSseClient()
    const chatStore = useWebUiChatStore()
    const { activeRunConversationId, conversations, messages, selectedConversationId } = storeToRefs(chatStore)
    const bridgeState = ref<'checking' | 'connected' | 'offline'>('checking')
    const bridgeDetail = ref('Checking desktop bridge')
    const serviceStartedAt = ref('Pending')
    const sseClientCount = ref('0')
    const conversationLoadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const conversationLoadMessage = ref('Loading conversations')
    const messageLoadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const messageLoadMessage = ref('Select a desktop conversation to read its messages.')
    const composerText = ref('')
    const submitError = ref('')
    const agents = ref<readonly WebUiAgentEntity[]>([])
    const newConversationOpen = ref(false)
    const newConversationState = ref<'idle' | 'loading' | 'creating' | 'error'>('idle')
    const newConversationError = ref('')
    const selectedAgentId = ref('')
    const messageStack = ref<HTMLElement>()
    const pendingChunks = new Map<string, WebUiChunkPayload[]>()
    let healthTimer: number | undefined
    let syncTimer: number | undefined
    let chunkFrame: number | undefined
    let latestMessageRequest = 0

    const selectedConversation = computed(() =>
      conversations.value.find((conversation) => conversation.id === selectedConversationId.value)
    )

    const statusItems = computed<readonly WebuiStatus[]>(() => [
      {
        label: 'Runtime',
        value: bridgeDetail.value
      },
      {
        label: 'Started',
        value: serviceStartedAt.value
      },
      {
        label: 'SSE clients',
        value: sseClientCount.value
      }
    ])

    const refreshHealth = async () => {
      try {
        const health = await httpClient.getJson<WebUiHealthResponse>('/api/health')
        bridgeState.value = health.ok ? 'connected' : 'offline'
        bridgeDetail.value = health.ok ? 'Win11 desktop bridge connected' : 'Desktop bridge unavailable'
        serviceStartedAt.value = new Date(health.startedAt).toLocaleString()
        sseClientCount.value = String(health.sseClients)
      } catch (error) {
        bridgeState.value = 'offline'
        bridgeDetail.value = toErrorMessage(error)
        serviceStartedAt.value = 'Unavailable'
        sseClientCount.value = '0'
      }
    }

    const loadConversations = async () => {
      conversationLoadState.value = 'loading'
      conversationLoadMessage.value = 'Loading conversations'

      try {
        const sessions: WebUiAgentSessionEntity[] = []
        const seenCursors = new Set<string>()
        let cursor: string | undefined
        do {
          const query = new URLSearchParams({ limit: '200' })
          if (cursor) query.set('cursor', cursor)
          const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionEntity>>(
            `/api/data/agent-sessions?${query.toString()}`
          )
          sessions.push(...page.items)
          cursor = page.nextCursor
          if (cursor && seenCursors.has(cursor)) break
          if (cursor) seenCursors.add(cursor)
        } while (cursor)
        conversations.value = sessions.map(toConversationSummary)
        if (
          selectedConversationId.value &&
          !conversations.value.some((conversation) => conversation.id === selectedConversationId.value)
        ) {
          selectedConversationId.value = undefined
          messages.value = []
          messageLoadState.value = 'idle'
          messageLoadMessage.value = 'The selected desktop conversation is no longer available.'
        }
        conversationLoadState.value = 'ready'
        conversationLoadMessage.value = conversations.value.length ? '' : 'No desktop sessions yet'
      } catch (error) {
        conversations.value = []
        conversationLoadState.value = 'error'
        conversationLoadMessage.value = toErrorMessage(error)
      }
    }

    const loadConversationMessages = async (conversationId: string) => {
      const requestId = ++latestMessageRequest
      messageLoadState.value = 'loading'
      messageLoadMessage.value = 'Loading desktop messages'

      try {
        const sessionMessages: WebUiAgentSessionMessageEntity[] = []
        const seenCursors = new Set<string>()
        let cursor: string | undefined
        do {
          const query = new URLSearchParams({ limit: '200' })
          if (cursor) query.set('cursor', cursor)
          const page = await httpClient.getJson<WebUiCursorResponse<WebUiAgentSessionMessageEntity>>(
            `/api/data/agent-sessions/${encodeURIComponent(conversationId)}/messages?${query.toString()}`
          )
          sessionMessages.push(...page.items)
          cursor = page.nextCursor
          if (cursor && seenCursors.has(cursor)) break
          if (cursor) seenCursors.add(cursor)
        } while (cursor)
        if (requestId !== latestMessageRequest || selectedConversationId.value !== conversationId) return

        messages.value = sessionMessages.map(toMessageSnapshot).reverse()
        messageLoadState.value = 'ready'
        messageLoadMessage.value = messages.value.length ? '' : 'This desktop conversation has no messages yet.'
      } catch (error) {
        if (requestId !== latestMessageRequest || selectedConversationId.value !== conversationId) return

        messages.value = []
        messageLoadState.value = 'error'
        messageLoadMessage.value = toErrorMessage(error)
      }
    }

    const selectConversation = (conversationId: string) => {
      if (conversationId === selectedConversationId.value) return

      selectedConversationId.value = conversationId
      void loadConversationMessages(conversationId)
    }

    const openNewConversation = async () => {
      newConversationOpen.value = true
      newConversationState.value = 'loading'
      newConversationError.value = ''

      try {
        const page = await httpClient.getJson<WebUiOffsetResponse<WebUiAgentEntity>>('/api/data/agents')
        agents.value = page.items.filter((agent) => Boolean(agent.model))
        selectedAgentId.value = agents.value[0]?.id ?? ''
        newConversationState.value = 'idle'
        if (!agents.value.length) newConversationError.value = 'No configured desktop Agents are available.'
      } catch (error) {
        agents.value = []
        selectedAgentId.value = ''
        newConversationState.value = 'error'
        newConversationError.value = toErrorMessage(error)
      }
    }

    const createConversation = async () => {
      if (!selectedAgentId.value || newConversationState.value === 'creating') return

      newConversationState.value = 'creating'
      newConversationError.value = ''
      try {
        const session = await httpClient.postJson<WebUiAgentSessionEntity>('/api/data/agent-sessions', {
          agentId: selectedAgentId.value,
          name: '',
          workspace: { type: 'system' }
        })
        newConversationOpen.value = false
        await loadConversations()
        selectConversation(session.id)
      } catch (error) {
        newConversationState.value = 'error'
        newConversationError.value = toErrorMessage(error)
      }
    }

    const refreshFromDesktopSync = () => {
      if (syncTimer) window.clearTimeout(syncTimer)
      syncTimer = window.setTimeout(() => {
        syncTimer = undefined
        void loadConversations()
        if (selectedConversationId.value) void loadConversationMessages(selectedConversationId.value)
      }, 180)
    }

    const applyStreamChunk = (payload: WebUiChunkPayload) => {
      if (payload.conversationId !== selectedConversationId.value) return

      const messageIndex = messages.value.findIndex((message) => message.id === payload.messageId)
      if (messageIndex < 0) return

      const nextMessages = [...messages.value]
      const message = nextMessages[messageIndex]
      if (!message) return
      nextMessages[messageIndex] =
        payload.kind === 'reasoning'
          ? { ...message, reasoning: `${message.reasoning ?? ''}${payload.delta}` }
          : { ...message, content: `${message.content}${payload.delta}` }
      messages.value = nextMessages
    }

    const queueStreamChunk = (payload: WebUiChunkPayload) => {
      const chunks = pendingChunks.get(payload.messageId) ?? []
      chunks.push(payload)
      pendingChunks.set(payload.messageId, chunks)
      if (chunkFrame !== undefined) return

      chunkFrame = window.requestAnimationFrame(() => {
        chunkFrame = undefined
        for (const queued of pendingChunks.values()) {
          for (const chunk of queued) applyStreamChunk(chunk)
        }
        pendingChunks.clear()
      })
    }

    const scrollMessagesToEnd = () => {
      void nextTick(() => {
        if (messageStack.value) messageStack.value.scrollTop = messageStack.value.scrollHeight
      })
    }

    watch(messages, scrollMessagesToEnd)

    const submitMessage = async () => {
      const conversationId = selectedConversationId.value
      const text = composerText.value.trim()
      if (!conversationId || !text || activeRunConversationId.value) return

      submitError.value = ''
      activeRunConversationId.value = conversationId
      try {
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/messages`, { text })
        composerText.value = ''
        await loadConversationMessages(conversationId)
      } catch (error) {
        submitError.value = toErrorMessage(error)
        activeRunConversationId.value = undefined
      }
    }

    const abortMessage = async () => {
      const conversationId = selectedConversationId.value
      if (!conversationId || activeRunConversationId.value !== conversationId) return

      try {
        await httpClient.postJson(`/api/agent-sessions/${encodeURIComponent(conversationId)}/abort`, {})
      } catch (error) {
        submitError.value = toErrorMessage(error)
        activeRunConversationId.value = undefined
      }
    }

    const unsubscribeSync = sseClient.subscribe('sync', refreshFromDesktopSync)
    const unsubscribeChunk = sseClient.subscribe<WebUiChunkPayload>('chunk', ({ data }) => {
      if (data && typeof data === 'object') queueStreamChunk(data)
    })
    const unsubscribeDone = sseClient.subscribe<{ conversationId?: string }>('done', ({ data }) => {
      if (data?.conversationId === activeRunConversationId.value) activeRunConversationId.value = undefined
    })
    const unsubscribeError = sseClient.subscribe<{ conversationId?: string; message?: string }>('error', ({ data }) => {
      if (data?.conversationId === activeRunConversationId.value) {
        submitError.value = data.message ?? 'Desktop generation failed'
        activeRunConversationId.value = undefined
      }
    })

    onMounted(() => {
      void refreshHealth()
      void loadConversations()
      sseClient.connect()
      healthTimer = window.setInterval(() => void refreshHealth(), 15_000)
    })

    onBeforeUnmount(() => {
      if (healthTimer) window.clearInterval(healthTimer)
      if (syncTimer) window.clearTimeout(syncTimer)
      if (chunkFrame !== undefined) window.cancelAnimationFrame(chunkFrame)
      pendingChunks.clear()
      unsubscribeSync()
      unsubscribeChunk()
      unsubscribeDone()
      unsubscribeError()
      sseClient.close()
    })

    return () =>
      h('main', { class: 'webui-shell' }, [
        h('section', { class: 'conversation-list', 'aria-label': 'Conversation list' }, [
          h('header', { class: 'panel-header' }, [
            h('span', { class: 'brand-mark' }, 'CS'),
            h('div', [
              h('p', { class: 'eyebrow' }, 'Cherry Studio'),
              h('h1', 'WebUI')
            ])
          ]),
          h(
            'button',
            {
              class: 'new-chat-button',
              type: 'button',
              onClick: () => void openNewConversation()
            },
            'New conversation'
          ),
          h(
            'p',
            { class: ['empty-copy', `empty-copy-${conversationLoadState.value}`] },
            conversationLoadMessage.value
          ),
          h(
            'nav',
            { class: 'conversation-nav', 'aria-label': 'Desktop conversations' },
            conversations.value.map((conversation) =>
              h(
                'button',
                {
                  key: conversation.id,
                  type: 'button',
                  class: [
                    'conversation-item',
                    { 'conversation-item-selected': conversation.id === selectedConversationId.value }
                  ],
                  'aria-current': conversation.id === selectedConversationId.value ? 'page' : undefined,
                  onClick: () => selectConversation(conversation.id)
                },
                [
                  h('span', { class: 'conversation-title' }, conversation.title),
                  h('span', { class: 'conversation-meta' }, [
                    conversation.workspaceLabel ? `${conversation.workspaceLabel} · ` : '',
                    new Date(conversation.updatedAt).toLocaleString()
                  ])
                ]
              )
            )
          )
        ]),
        h('section', { class: 'chat-stage', 'aria-label': 'Desktop conversation' }, [
          h('header', { class: 'chat-header' }, [
            h('p', { class: 'eyebrow' }, selectedConversation.value?.workspaceLabel ?? 'Desktop session'),
            h('h2', selectedConversation.value?.title ?? 'Select a conversation')
          ]),
          h('div', { class: 'message-stack', 'aria-live': 'polite', ref: messageStack }, [
            messageLoadMessage.value ? h('p', { class: 'empty-copy' }, messageLoadMessage.value) : undefined,
            ...messages.value.map((message) =>
              h(
                'article',
                {
                  class: ['message', message.role === 'user' ? 'user-message' : 'assistant-message'],
                  key: message.id
                },
                [
                  h('header', { class: 'message-header' }, [
                    h('p', { class: 'message-role' }, message.role),
                    message.content
                      ? h(
                          'button',
                          {
                            class: 'copy-button',
                            type: 'button',
                            onClick: () => void navigator.clipboard.writeText(message.content)
                          },
                          'Copy'
                        )
                      : undefined
                  ]),
                  message.reasoning
                    ? h('details', { class: 'reasoning-block' }, [
                        h('summary', 'Reasoning'),
                        h('div', { class: 'markdown-content', innerHTML: renderMarkdown(message.reasoning) })
                      ])
                    : undefined,
                  message.content
                    ? h('div', { class: 'markdown-content', innerHTML: renderMarkdown(message.content) })
                    : h('span', { class: 'streaming-placeholder', 'aria-label': 'Generating' }),
                  h('time', { class: 'message-time', datetime: message.createdAt }, new Date(message.createdAt).toLocaleString())
                ]
              )
            )
          ]),
          h('footer', { class: 'composer' }, [
            h('textarea', {
              disabled: !selectedConversation.value || activeRunConversationId.value === selectedConversationId.value,
              value: composerText.value,
              placeholder: selectedConversation.value
                ? 'Send a message to this desktop Agent session'
                : 'Select a desktop conversation first',
              rows: 3,
              onInput: (event: Event) => {
                composerText.value = (event.target as HTMLTextAreaElement).value
              },
              onKeydown: (event: KeyboardEvent) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submitMessage()
                }
              }
            }),
            h(
              'button',
              {
                class: 'send-button',
                type: 'button',
                disabled: !selectedConversation.value || (!composerText.value.trim() && activeRunConversationId.value !== selectedConversationId.value),
                onClick: () => {
                  if (activeRunConversationId.value === selectedConversationId.value) {
                    void abortMessage()
                    return
                  }
                  void submitMessage()
                }
              },
              activeRunConversationId.value === selectedConversationId.value ? 'Stop' : 'Send'
            )
          ]),
          submitError.value ? h('p', { class: 'composer-error', role: 'alert' }, submitError.value) : undefined
        ]),
        h('aside', { class: 'status-panel', 'aria-label': 'Connection status' }, [
          h('h2', 'Bridge status'),
          h('div', {
            class: ['bridge-indicator', `bridge-indicator-${bridgeState.value}`],
            role: 'status',
            'aria-live': 'polite'
          }),
          ...statusItems.value.map((item) =>
            h('dl', { class: 'status-row', key: item.label }, [
              h('dt', item.label),
              h('dd', item.value)
            ])
          )
        ]),
        newConversationOpen.value
          ? h('div', { class: 'modal-backdrop' }, [
              h('section', { class: 'new-conversation-dialog', role: 'dialog', 'aria-modal': 'true' }, [
                h('header', { class: 'dialog-header' }, [
                  h('h2', 'New conversation'),
                  h(
                    'button',
                    {
                      class: 'icon-button',
                      type: 'button',
                      title: 'Close',
                      'aria-label': 'Close',
                      onClick: () => {
                        newConversationOpen.value = false
                      }
                    },
                    '×'
                  )
                ]),
                h('label', { class: 'field-label', for: 'agent-select' }, 'Agent'),
                h(
                  'select',
                  {
                    id: 'agent-select',
                    disabled: newConversationState.value === 'loading' || !agents.value.length,
                    value: selectedAgentId.value,
                    onChange: (event: Event) => {
                      selectedAgentId.value = (event.target as HTMLSelectElement).value
                    }
                  },
                  agents.value.map((agent) =>
                    h('option', { key: agent.id, value: agent.id }, `${agent.name} · ${agent.modelName ?? agent.model}`)
                  )
                ),
                newConversationError.value
                  ? h('p', { class: 'composer-error', role: 'alert' }, newConversationError.value)
                  : undefined,
                h('footer', { class: 'dialog-actions' }, [
                  h(
                    'button',
                    {
                      class: 'secondary-button',
                      type: 'button',
                      onClick: () => {
                        newConversationOpen.value = false
                      }
                    },
                    'Cancel'
                  ),
                  h(
                    'button',
                    {
                      class: 'send-button',
                      type: 'button',
                      disabled: !selectedAgentId.value || newConversationState.value === 'creating',
                      onClick: () => void createConversation()
                    },
                    newConversationState.value === 'creating' ? 'Creating…' : 'Create'
                  )
                ])
              ])
            ])
          : undefined
      ])
  }
})

const style = document.createElement('style')
style.textContent = `
  :root {
    color: #1f2937;
    background: #f6f7fb;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    min-width: 320px;
    min-height: 100vh;
    margin: 0;
  }

  button,
  textarea,
  select {
    font: inherit;
  }

  .webui-shell {
    display: grid;
    grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(220px, 260px);
    min-height: 100vh;
  }

  .conversation-list,
  .status-panel {
    padding: 20px;
    background: #ffffff;
    border-color: #e5e7eb;
  }

  .conversation-list {
    border-right: 1px solid #e5e7eb;
  }

  .status-panel {
    border-left: 1px solid #e5e7eb;
  }

  .panel-header {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 24px;
  }

  .brand-mark {
    display: inline-grid;
    width: 40px;
    height: 40px;
    place-items: center;
    color: #ffffff;
    font-weight: 700;
    background: #d7354a;
    border-radius: 8px;
  }

  .eyebrow {
    margin: 0 0 2px;
    color: #6b7280;
    font-size: 12px;
  }

  h1,
  h2,
  p {
    margin-top: 0;
  }

  h1 {
    margin-bottom: 0;
    font-size: 22px;
  }

  h2 {
    margin-bottom: 16px;
    font-size: 16px;
  }

  .new-chat-button,
  .send-button {
    min-height: 36px;
    padding: 0 14px;
    color: #ffffff;
    background: #111827;
    border: 0;
    border-radius: 8px;
  }

  .new-chat-button {
    width: 100%;
  }

  .secondary-button,
  .icon-button {
    min-height: 36px;
    padding: 0 14px;
    color: #1f2937;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    cursor: pointer;
  }

  .icon-button {
    width: 36px;
    padding: 0;
    font-size: 22px;
  }

  button:disabled,
  textarea:disabled {
    cursor: not-allowed;
    opacity: 0.58;
  }

  .empty-copy {
    margin-top: 18px;
    color: #6b7280;
    font-size: 14px;
    line-height: 1.6;
  }

  .conversation-nav {
    display: grid;
    gap: 8px;
    margin-top: 18px;
  }

  .conversation-item {
    display: grid;
    width: 100%;
    min-height: 58px;
    padding: 10px 12px;
    text-align: left;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    cursor: pointer;
  }

  .conversation-item:hover,
  .conversation-item-selected {
    background: #eef2ff;
    border-color: #a5b4fc;
  }

  .conversation-title {
    overflow: hidden;
    color: #111827;
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-meta {
    overflow: hidden;
    color: #6b7280;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-stage {
    display: grid;
    grid-template-rows: auto 1fr auto;
    min-width: 0;
    padding: 28px;
  }

  .message-stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 4px;
  }

  .chat-header {
    padding-bottom: 16px;
    border-bottom: 1px solid #e5e7eb;
  }

  .chat-header h2 {
    margin-bottom: 0;
  }

  .message {
    max-width: min(680px, 86%);
    padding: 14px 16px;
    line-height: 1.6;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
  }

  .user-message {
    align-self: flex-end;
    color: #ffffff;
    background: #2563eb;
    border-color: #2563eb;
  }

  .assistant-message {
    align-self: flex-start;
  }

  .message p {
    margin-bottom: 0;
  }

  .message-role,
  .message-time {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    opacity: 0.78;
  }

  .message-header {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  .copy-button {
    padding: 2px 6px;
    color: inherit;
    font-size: 12px;
    background: transparent;
    border: 0;
    cursor: pointer;
    opacity: 0.72;
  }

  .markdown-content {
    overflow-wrap: anywhere;
  }

  .markdown-content > :first-child {
    margin-top: 0;
  }

  .markdown-content > :last-child {
    margin-bottom: 0;
  }

  .markdown-content pre {
    max-width: 100%;
    padding: 12px;
    overflow-x: auto;
    color: #e5e7eb;
    background: #17191f;
    border-radius: 6px;
  }

  .markdown-content code:not(pre code) {
    padding: 2px 5px;
    color: #9f1239;
    background: #fff1f2;
    border-radius: 4px;
  }

  .markdown-content a {
    color: #1d4ed8;
  }

  .reasoning-block {
    margin-bottom: 12px;
    padding: 10px 12px;
    color: #4b5563;
    background: #f3f4f6;
    border-left: 3px solid #9ca3af;
    border-radius: 4px;
  }

  .reasoning-block summary {
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .reasoning-block[open] summary {
    margin-bottom: 8px;
  }

  .streaming-placeholder {
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #6b7280;
    border-radius: 999px;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }

  .message-time {
    margin-top: 10px;
    margin-bottom: 0;
  }

  .composer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: end;
    margin-top: 24px;
  }

  textarea {
    width: 100%;
    min-height: 76px;
    resize: vertical;
    padding: 12px;
    color: #111827;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
  }

  .composer-error {
    margin: 8px 0 0;
    color: #b42318;
    font-size: 13px;
  }

  .modal-backdrop {
    position: fixed;
    z-index: 20;
    display: grid;
    inset: 0;
    place-items: center;
    padding: 20px;
    background: rgb(17 24 39 / 48%);
  }

  .new-conversation-dialog {
    width: min(440px, 100%);
    padding: 20px;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    box-shadow: 0 18px 48px rgb(17 24 39 / 18%);
  }

  .dialog-header,
  .dialog-actions {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  .dialog-header h2 {
    margin-bottom: 0;
  }

  .field-label {
    display: block;
    margin: 24px 0 8px;
    font-size: 13px;
    font-weight: 600;
  }

  select {
    width: 100%;
    min-height: 40px;
    padding: 0 10px;
    color: #111827;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
  }

  .dialog-actions {
    justify-content: flex-end;
    margin-top: 24px;
  }

  .status-row {
    margin: 0 0 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid #f0f1f4;
  }

  .bridge-indicator {
    width: 10px;
    height: 10px;
    margin-bottom: 16px;
    background: #f59e0b;
    border-radius: 999px;
  }

  .bridge-indicator-connected {
    background: #16a34a;
  }

  .bridge-indicator-offline {
    background: #dc2626;
  }

  .status-row dt {
    margin-bottom: 4px;
    color: #6b7280;
    font-size: 12px;
  }

  .status-row dd {
    margin: 0;
    font-size: 14px;
  }

  @media (max-width: 900px) {
    .webui-shell {
      grid-template-columns: 1fr;
    }

    .conversation-list,
    .status-panel {
      border: 0;
    }

    .chat-stage {
      min-height: 520px;
    }
  }
`
document.head.appendChild(style)

createApp(App).use(createPinia()).mount('#app')
