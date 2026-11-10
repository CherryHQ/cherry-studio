import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { ChatLayoutModeProvider } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { DEFAULT_MESSAGE_LIST_CONFIG, type MessageListProviderValue } from '@renderer/components/chat/messages/types'
import ComposerSurface from '@renderer/components/composer/ComposerSurface'
import { usePreference } from '@renderer/data/hooks/usePreference'
import {
  acceptSideChat,
  clearSubmittedSideChatDraft,
  connectSideChats,
  useSideChatDraft,
  useSideChats
} from '@renderer/hooks/useSideChats'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toContentRole } from '@shared/data/types/message'
import type { SideChatSource } from '@shared/data/types/sideChat'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { sideChatErrorCodes } from '@shared/ipc/errors/sideChat'
import type { SideChatView } from '@shared/ipc/schemas/sideChat'

import { useSideChatContext } from './SideChatContext'

export function SideChatPanel() {
  const context = useSideChatContext()
  const views = useSideChats(context?.sourceTopicId)
  const { t } = useTranslation()
  const [creation, setCreation] = useState<{ source: SideChatSource; busy: boolean; error?: string }>()
  if (!context) return null
  const busy = creation?.source === context.pending && creation?.busy
  const error = creation?.source === context.pending ? creation?.error : undefined
  const active = views.find((view) => view.topicId === context.selectedId)
  const create = async () => {
    if (!context.pending || busy) return
    const source = context.pending
    if (!context.modelId) {
      setCreation({ source, busy: false, error: 'code.model_required' })
      return
    }
    setCreation({ source, busy: true })
    connectSideChats()
    try {
      const view = acceptSideChat(
        await ipcApi.request('side_chat.create', {
          source,
          config: { modelId: context.modelId }
        })
      )
      context.completeCreate(source, view.topicId)
    } catch (cause) {
      setCreation((current) =>
        current?.source === source
          ? {
              source,
              busy: false,
              error:
                cause instanceof IpcError && cause.code === sideChatErrorCodes.MODEL_UNAVAILABLE
                  ? 'code.model_required'
                  : 'side_chat.request_error'
            }
          : current
      )
    } finally {
      setCreation((current) => (current?.source === source ? { ...current, busy: false } : current))
    }
  }
  return (
    <ChatLayoutModeProvider>
      <section aria-label={t('side_chat.title')} className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
        {context.loading && <p role="status">{t('common.loading')}</p>}
        {context.error && (
          <div role="alert">
            {t('side_chat.load_error')}{' '}
            <Button variant="ghost" onClick={context.reload}>
              {t('common.retry')}
            </Button>
          </div>
        )}
        <nav aria-label={t('side_chat.title')} className="flex max-h-36 shrink-0 flex-col gap-1 overflow-auto">
          {views.map((view) => (
            <Button
              key={view.topicId}
              variant={active?.topicId === view.topicId ? 'secondary' : 'ghost'}
              className="justify-start truncate"
              onClick={() => context.open(view.topicId)}>
              <span className="truncate">{view.metadata.snapshot.selection}</span>
            </Button>
          ))}
        </nav>
        {context.pending && (
          <div className="flex flex-col gap-2">
            <blockquote className="max-h-32 overflow-auto whitespace-pre-wrap text-sm">
              {context.pending.selection}
            </blockquote>
            <Button disabled={busy} onClick={() => void create()}>
              {t('side_chat.create')}
            </Button>
            {error && <p role="alert">{t(error)}</p>}
          </div>
        )}
        {active ? (
          <SideChatConversation key={active.topicId} view={active} />
        ) : (
          !context.pending && <p>{t('side_chat.empty')}</p>
        )}
      </section>
    </ChatLayoutModeProvider>
  )
}

function SideChatConversation({ view }: { view: SideChatView }) {
  const { t } = useTranslation()
  const context = useSideChatContext()!
  const [draft, setDraft] = useSideChatDraft(view.topicId)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { renderConfig } = useMessageListRenderConfig()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const agentSource = view.sourceTopicId.startsWith('agent-session:')
  const missingModel = !agentSource && !context.modelId
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      await operation()
    } catch (cause) {
      setError(
        cause instanceof IpcError && cause.code === sideChatErrorCodes.MODEL_UNAVAILABLE
          ? 'code.model_required'
          : 'side_chat.request_error'
      )
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
      partsByMessageId: Object.fromEntries(view.messages.map((message) => [message.id, message.data.parts ?? []])),
      messageNavigation: 'none',
      ...DEFAULT_MESSAGE_LIST_CONFIG,
      listKey: view.topicId,
      renderConfig
    },
    actions: {
      regenerateMessage:
        busy || view.generating
          ? undefined
          : (messageId) =>
              run(async () => {
                const id = questionId(messageId)
                if (!id) return
                acceptSideChat(
                  await ipcApi.request('side_chat.retry', {
                    topicId: view.topicId,
                    questionId: id,
                    modelId: context.modelId
                  })
                )
              }),
      deleteMessage:
        busy || view.generating
          ? undefined
          : (messageId) =>
              run(async () => {
                const id = questionId(messageId)
                if (!id) return
                acceptSideChat(
                  await ipcApi.request('side_chat.delete_question', { topicId: view.topicId, questionId: id })
                )
              })
    },
    meta: { selectionLayer: false }
  }
  const remove = async (deleting: boolean) => {
    if (
      (deleting || view.mode === 'temporary') &&
      !(await popup.confirm({ title: t('side_chat.clear_title'), content: t('side_chat.clear_description') }))
    )
      return
    await ipcApi.request(deleting ? 'side_chat.delete' : 'side_chat.close', { topicId: view.topicId })
    context.select(undefined)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="shrink-0 text-xs text-muted-foreground">
        {t(view.mode === 'saved' ? 'side_chat.saved' : 'side_chat.temporary')}
      </p>
      <blockquote className="max-h-24 shrink-0 overflow-auto border-l-2 border-border pl-3 whitespace-pre-wrap text-sm">
        {view.metadata.snapshot.selection}
      </blockquote>
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
      {error && <p role="alert">{t(error)}</p>}
      <ComposerSurface
        text={draft}
        onTextChange={setDraft}
        tokens={[]}
        managedTokenKinds={[]}
        onTokensChange={() => {}}
        placeholder={t('side_chat.question')}
        sendDisabled={busy || view.generating || missingModel || !draft.trim()}
        sendBlockedReason={missingModel ? t('code.model_required') : undefined}
        isLoading={view.generating}
        onSendDraft={({ text }) =>
          run(async () => {
            acceptSideChat(
              await ipcApi.request('side_chat.submit', { topicId: view.topicId, text, modelId: context.modelId })
            )
            clearSubmittedSideChatDraft(view.topicId, text)
          })
        }
        onPause={() =>
          run(async () => acceptSideChat(await ipcApi.request('side_chat.stop', { topicId: view.topicId })))
        }
        supportedExts={[]}
        setFiles={() => {}}
        filesCount={0}
        isExpanded={expanded}
        onExpandedChange={setExpanded}
        quickPanelEnabled={false}
        enableDragDrop={false}
        enableSpellCheck={enableSpellCheck}
        fontSize={renderConfig.fontSize}
        narrowMode={false}
      />
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => void run(() => remove(false))}>
          {t(view.mode === 'temporary' ? 'side_chat.close_temporary' : 'common.close')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run(() => remove(true))}>
          {t('common.delete')}
        </Button>
      </div>
    </div>
  )
}
