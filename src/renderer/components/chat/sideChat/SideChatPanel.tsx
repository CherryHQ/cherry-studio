import { Trash2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { ChatLayoutModeProvider } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import ErrorBlock from '@renderer/components/chat/messages/blocks/ErrorBlock'
import { useMessageErrorActions } from '@renderer/components/chat/messages/hooks/useMessageErrorActions'
import { useMessageExportActions } from '@renderer/components/chat/messages/hooks/useMessageExportActions'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { useMessageMenuConfig } from '@renderer/components/chat/messages/hooks/useMessageMenuConfig'
import { useMessagePlatformActions } from '@renderer/components/chat/messages/hooks/useMessagePlatformActions'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import {
  DEFAULT_MESSAGE_LIST_CONFIG,
  type MessageListItem,
  type MessageListProviderValue
} from '@renderer/components/chat/messages/types'
import { useRightPanelActions, useRightPanelState } from '@renderer/components/chat/panes/Shell'
import { createComposerMessageSnapshot } from '@renderer/components/composer/composerDraft'
import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { createQuoteToken } from '@renderer/components/composer/variants/shared/composerQuote'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { usePreference } from '@renderer/data/hooks/usePreference'
import {
  acceptSideChat,
  clearSubmittedSideChatDraft,
  connectSideChats,
  useSideChatDraft,
  usePendingSideChatDraft,
  useSideChats
} from '@renderer/hooks/useSideChats'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import type { PendingSideChatDraft } from '@renderer/services/SideChatState'
import { toast } from '@renderer/services/toast'
import type { SerializedError } from '@renderer/types/error'
import type { ExportMessagesToObsidian } from '@renderer/types/messageExport'
import { getErrorMessage, serializeHealthCheckError } from '@renderer/utils/error'
import { toContentRole, type CherryMessagePart, type Message } from '@shared/data/types/message'
import type { SideChatSource } from '@shared/data/types/sideChat'
import { readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import type { SideChatView } from '@shared/ipc/schemas/sideChat'

import { SideChatComposer } from './SideChatComposer'
import { useSideChatContext } from './SideChatContext'

// Side-chat errors stay local: do not start cached AI diagnosis or attach main-chat incidents.
const getDoctorSubject = () => undefined

const exportToObsidian: ExportMessagesToObsidian = async (title, messages) => {
  const { default: popup } = await import('@renderer/components/ObsidianExportPopup')
  return popup.show({ title, messages, processingMethod: '1' })
}

function SideChatRequestError({ error, topicId }: { error: SerializedError; topicId?: string }) {
  const context = useSideChatContext()!
  const { renderConfig } = useMessageListRenderConfig()
  const { openErrorDetail, navigateErrorTarget } = useMessageErrorActions({ getDoctorSubject })
  const message: MessageListItem = {
    id: 'side-chat-request-error',
    topicId: topicId ?? 'side-chat-pending',
    role: 'assistant',
    status: 'error',
    createdAt: '',
    modelId: context.modelId
  }
  return (
    <MessageListProvider
      value={{
        state: {
          ...DEFAULT_MESSAGE_LIST_CONFIG,
          topic: {
            id: message.topicId,
            assistantId: undefined,
            name: '',
            messages: [],
            createdAt: '',
            updatedAt: '',
            lastActivityAt: ''
          },
          messages: [message],
          partsByMessageId: {},
          messageNavigation: 'none',
          renderConfig
        },
        actions: { openErrorDetail, navigateErrorTarget },
        meta: { selectionLayer: false }
      }}>
      <div role="alert">
        <ErrorBlock partId={message.id} error={error} message={message} />
      </div>
    </MessageListProvider>
  )
}

export function SideChatDeleteButton() {
  const { t } = useTranslation()
  const context = useSideChatContext()
  const views = useSideChats(context?.sourceTopicId)
  const actions = useRightPanelActions()
  const panelState = useRightPanelState()
  const current = useRef<{ context: typeof context; panelState: typeof panelState } | null>(null)
  useLayoutEffect(() => {
    current.current = { context, panelState }
    return () => {
      current.current = null
    }
  }, [context, panelState])
  const [busy, setBusy] = useState(false)
  const active = !context?.pending && views.find((view) => view.topicId === context?.selectedId)
  if (!active) return null

  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (!(await popup.confirm({ title: t('side_chat.clear_title'), content: t('side_chat.clear_description') })))
        return
      await ipcApi.request('side_chat.delete', { topicId: active.topicId })
      const latest = current.current
      // A completed deletion must not close a different selection opened in the meantime.
      if (
        latest?.context?.sourceTopicId === active.sourceTopicId &&
        latest.context.selectedId === active.topicId &&
        !latest.context.pending
      ) {
        latest.context.select(undefined)
        if (latest.panelState.isActive('side-chat')) actions.close()
      }
    } catch (cause) {
      toast.error(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip content={t('common.delete')} delay={800}>
      <NavbarIcon tone="conversation" aria-label={t('common.delete')} disabled={busy} onClick={() => void remove()}>
        <Trash2 aria-hidden="true" />
      </NavbarIcon>
    </Tooltip>
  )
}

export function SideChatPanel() {
  const context = useSideChatContext()
  const views = useSideChats(context?.sourceTopicId)
  const { t } = useTranslation()
  if (!context) return null
  const active = views.find((view) => view.topicId === context.selectedId)
  return (
    <ChatLayoutModeProvider>
      <section aria-label={t('side_chat.title')} className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        {context.loading && <p role="status">{t('common.loading')}</p>}
        {context.error && (
          <div role="alert">
            {t('side_chat.load_error')}{' '}
            <Button variant="ghost" onClick={context.reload}>
              {t('common.retry')}
            </Button>
          </div>
        )}
        {context.pending ? (
          <PendingSideChat source={context.pending} />
        ) : active ? (
          <SideChatConversation key={active.topicId} view={active} />
        ) : (
          <p>{t('side_chat.empty')}</p>
        )}
      </section>
    </ChatLayoutModeProvider>
  )
}

function PendingSideChat({ source }: { source: SideChatSource }) {
  const { t } = useTranslation()
  const context = useSideChatContext()!
  const { renderConfig } = useMessageListRenderConfig()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [expanded, setExpanded] = useState(false)
  const [saveHistory] = usePreference('chat.side_chat.save_history')
  const createDraft = (): PendingSideChatDraft => {
    const quote = createQuoteToken(source.selection!, t('selection.action.builtin.quote'))
    return {
      files: [],
      knowledgeBaseIds: [],
      key: quote.id,
      text: `${quote.promptText} `,
      tokens: [{ ...quote, index: 0, textOffset: 0 }],
      busy: false
    }
  }
  const [draft, update] = usePendingSideChatDraft(source, createDraft)
  const send = async (
    submitted: ComposerSerializedDraft,
    parts: CherryMessagePart[],
    turnOptions: Message['data']['turnOptions']
  ) => {
    const { text } = submitted
    if (draft.busy || (!text.trim() && !parts.some((part) => part.type === 'file')) || !context.modelId) return false
    update({ busy: true, error: undefined })
    connectSideChats()
    try {
      let topicId = draft.topicId
      if (!topicId) {
        const view = acceptSideChat(
          await ipcApi.request('side_chat.create', { source, config: { modelId: context.modelId } })
        )
        topicId = view.topicId
        update({ topicId })
      }
      acceptSideChat(
        await ipcApi.request('side_chat.submit', {
          topicId,
          text,
          parts,
          turnOptions,
          modelId: context.modelId,
          composer: createComposerMessageSnapshot(submitted)
        })
      )
      context.completeCreate(source, topicId)
      return true
    } catch (cause) {
      update({
        error: serializeHealthCheckError(cause)
      })
      return false
    } finally {
      update({ busy: false })
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-20 flex-1" />
      {draft.error && <SideChatRequestError error={draft.error} topicId={draft.topicId} />}
      <SideChatComposer
        temporary={!saveHistory}
        key={draft.key}
        text={draft.text}
        onTextChange={(text) => update({ text })}
        draftTokens={draft.tokens}
        onTokensChange={(tokens) => update({ tokens: [...tokens] })}
        placeholder={t('side_chat.question')}
        sendDisabled={draft.busy || !context.modelId}
        sendBlockedReason={!context.modelId ? t('code.model_required') : undefined}
        editable={!draft.busy}
        isLoading={false}
        onSendDraft={send}
        onPause={() => {}}
        isExpanded={expanded}
        onExpandedChange={setExpanded}
        enableSpellCheck={enableSpellCheck}
        fontSize={renderConfig.fontSize}
        narrowMode={false}
      />
    </div>
  )
}

function SideChatConversation({ view }: { view: SideChatView }) {
  const { t } = useTranslation()
  const context = useSideChatContext()!
  const [draft, setDraft] = useSideChatDraft(view.topicId)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SerializedError>()
  const { openErrorDetail, navigateErrorTarget } = useMessageErrorActions({ getDoctorSubject })
  const platformActions = useMessagePlatformActions()
  const exportActions = useMessageExportActions({ topicName: t('side_chat.title'), exportToObsidian })
  const menuConfig = useMessageMenuConfig()
  const { renderConfig } = useMessageListRenderConfig()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const agentSource = view.sourceTopicId.startsWith('agent-session:')
  const missingModel = !agentSource && !context.modelId
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return false
    setBusy(true)
    setError(undefined)
    try {
      await operation()
      return true
    } catch (cause) {
      setError(serializeHealthCheckError(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  const questionId = (messageId: string) => {
    const message = view.messages.find((item) => item.id === messageId)
    return message?.role === 'user' ? message.id : message?.parentId
  }
  const provider: MessageListProviderValue = {
    state: {
      topic: {
        id: view.topicId,
        assistantId: undefined,
        name: t('side_chat.title'),
        messages: [],
        createdAt: '',
        updatedAt: '',
        lastActivityAt: ''
      },
      messages: view.messages.map((message) => ({
        ...message,
        role: toContentRole(message.role),
        isActiveBranch: true,
        modelId: message.modelId ?? undefined,
        messageSnapshot: message.messageSnapshot ?? undefined,
        stats: message.stats ?? undefined
      })),
      partsByMessageId: Object.fromEntries(
        view.messages.map((message) => [
          message.id,
          (message.data.parts ?? []).map((part) => {
            if (message.role !== 'user' || part.type !== 'text' || readCherryMeta(part)?.composer) return part
            // Older side-chat messages stored the initial quote without its display metadata.
            const quote = createQuoteToken(view.metadata.snapshot.selection, t('selection.action.builtin.quote'))
            if (!part.text.startsWith(quote.promptText!)) return part
            return withCherryMeta(part, {
              composer: createComposerMessageSnapshot({
                text: part.text,
                tokens: [{ ...quote, id: `quote:${message.id}`, index: 0, textOffset: 0 }]
              })
            })
          })
        ])
      ),
      messageNavigation: 'none',
      ...DEFAULT_MESSAGE_LIST_CONFIG,
      listKey: view.topicId,
      menuConfig,
      renderConfig
    },
    actions: {
      ...platformActions,
      ...exportActions,
      openErrorDetail,
      navigateErrorTarget,
      respondToolApproval: async ({ match, approved }) => {
        if (!match.approvalId) return
        const approvalId = match.approvalId
        await run(async () =>
          acceptSideChat(
            await ipcApi.request('side_chat.respond_approval', {
              topicId: view.topicId,
              messageId: match.messageId,
              approvalId,
              approved
            })
          )
        )
      },
      deleteMessage:
        busy || view.generating
          ? undefined
          : (messageId) =>
              void run(async () => {
                const id = questionId(messageId)
                if (!id) return
                acceptSideChat(
                  await ipcApi.request('side_chat.delete_question', { topicId: view.topicId, questionId: id })
                )
              })
    },
    meta: { selectionLayer: false }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view.omittedContext.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('side_chat.omitted')}
        </p>
      )}
      <div className="min-h-20 flex-1 overflow-hidden">
        <MessageListProvider value={provider}>
          <MessageList />
        </MessageListProvider>
      </div>
      {error && <SideChatRequestError error={error} topicId={view.topicId} />}
      <SideChatComposer
        temporary={view.mode === 'temporary'}
        text={draft}
        onTextChange={setDraft}
        onTokensChange={() => {}}
        placeholder={t('side_chat.question')}
        sendDisabled={busy || view.generating || missingModel}
        sendBlockedReason={missingModel ? t('code.model_required') : undefined}
        isLoading={view.generating}
        onSendDraft={(submitted, parts, turnOptions) =>
          run(async () => {
            const { text } = submitted
            acceptSideChat(
              await ipcApi.request('side_chat.submit', {
                topicId: view.topicId,
                text,
                parts,
                turnOptions,
                modelId: context.modelId,
                composer: createComposerMessageSnapshot(submitted)
              })
            )
            clearSubmittedSideChatDraft(view.topicId, text)
          })
        }
        onPause={() =>
          void run(async () => acceptSideChat(await ipcApi.request('side_chat.stop', { topicId: view.topicId })))
        }
        isExpanded={expanded}
        onExpandedChange={setExpanded}
        enableSpellCheck={enableSpellCheck}
        fontSize={renderConfig.fontSize}
        narrowMode={false}
      />
    </div>
  )
}
