import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Textarea, Switch } from '@cherrystudio/ui'
import { ModelSelector } from '@renderer/components/ModelSelector'
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
import type { UniqueModelId } from '@shared/data/types/model'
import type { SideChatView } from '@shared/ipc/schemas/sideChat'
import { isNonChatModel } from '@shared/utils/model'

import { useSideChatContext } from './SideChatContext'

export function SideChatPanel() {
  const context = useSideChatContext()
  const views = useSideChats(context?.sourceTopicId)
  const { t } = useTranslation()
  const [save, setSave] = usePreference('chat.side_chat.save_history')
  const [modelId, setModelId] = useState<UniqueModelId>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  if (!context) return null
  const active = views.find((view) => view.topicId === context.selectedId)
  const create = async () => {
    if (!context.pending || !modelId || busy) return
    setBusy(true)
    setError(false)
    connectSideChats()
    try {
      const view = acceptSideChat(
        await ipcApi.request('side_chat.create', { source: context.pending, config: { modelId } })
      )
      context.select(view.topicId)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={t('side_chat.title')} className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
      <label className="flex items-center justify-between gap-2 text-sm">
        {t('side_chat.save_default')}
        <Switch checked={save} onCheckedChange={setSave} aria-label={t('side_chat.save_default')} />
      </label>
      <p className="shrink-0 text-xs text-muted-foreground">{t('side_chat.new_only')}</p>
      {context.loading && <p role="status">{t('common.loading')}</p>}
      {context.error && (
        <div role="alert">
          {t('side_chat.load_error')}{' '}
          <Button variant="ghost" onClick={context.reload}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      <nav aria-label={t('side_chat.title')} className="flex max-h-36 flex-col gap-1 overflow-auto">
        {views.map((view) => (
          <Button
            key={view.topicId}
            variant={active?.topicId === view.topicId ? 'secondary' : 'ghost'}
            className="justify-start truncate"
            onClick={() => context.open(view.topicId)}>
            <span className="truncate">{view.metadata.snapshot.selection}</span>
            <span>{t('side_chat.questions', { count: view.questionCount })}</span>
          </Button>
        ))}
      </nav>
      {context.pending && (
        <div className="flex flex-col gap-2">
          <p className="max-h-32 overflow-auto whitespace-pre-wrap text-sm">
            {context.pending.selection ?? t('side_chat.whole_answer')}
          </p>
          <ModelSelector
            filter={(model) => !isNonChatModel(model)}
            multiple={false}
            selectionType="id"
            value={modelId}
            onSelect={setModelId}
            trigger={<Button variant="outline">{modelId ?? t('side_chat.choose_model')}</Button>}
          />
          <Button disabled={!modelId || busy} onClick={() => void create()}>
            {t('side_chat.create')}
          </Button>
          {error && <p role="alert">{t('side_chat.request_error')}</p>}
        </div>
      )}
      {active ? (
        <SideChatConversation key={active.topicId} view={active} />
      ) : (
        !context.pending && <p>{t('side_chat.empty')}</p>
      )}
    </section>
  )
}

function SideChatConversation({ view }: { view: SideChatView }) {
  const { t } = useTranslation()
  const context = useSideChatContext()!
  const [draft, setDraft] = useSideChatDraft(view.topicId)
  const historyRef = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  useLayoutEffect(() => {
    const history = historyRef.current
    if (history && followOutput.current) history.scrollTop = history.scrollHeight
  }, [view.messages])
  const [prompt, setPrompt] = useState(view.metadata.config.prompt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      await operation()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (deleting: boolean) => {
    if (
      (deleting || view.mode === 'temporary') &&
      !(await popup.confirm({
        title: t('side_chat.clear_title'),
        content: t('side_chat.clear_description')
      }))
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
      <ModelSelector
        filter={(model) => !isNonChatModel(model)}
        multiple={false}
        selectionType="id"
        value={view.metadata.config.modelId}
        onSelect={(modelId) => {
          if (modelId)
            void run(async () =>
              acceptSideChat(
                await ipcApi.request('side_chat.configure', {
                  topicId: view.topicId,
                  config: { ...view.metadata.config, modelId }
                })
              )
            )
        }}
        trigger={
          <Button variant="outline" disabled={busy}>
            {view.metadata.config.modelId}
          </Button>
        }
      />
      <details className="max-h-40 shrink-0 overflow-auto text-sm">
        <summary className="cursor-pointer rounded-sm focus-visible:bg-muted">{t('side_chat.prompt')}</summary>
        <label className="text-sm">
          {t('side_chat.prompt')}
          <Textarea.Input value={prompt} maxLength={20000} onChange={(event) => setPrompt(event.target.value)} />
        </label>
        <Button
          variant="ghost"
          disabled={busy || prompt === view.metadata.config.prompt}
          onClick={() =>
            void run(async () =>
              acceptSideChat(
                await ipcApi.request('side_chat.configure', {
                  topicId: view.topicId,
                  config: { ...view.metadata.config, prompt }
                })
              )
            )
          }>
          {t('common.save')}
        </Button>
      </details>
      {view.omittedContext.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('side_chat.omitted')}
        </p>
      )}
      <div
        ref={historyRef}
        className="flex min-h-20 flex-1 flex-col gap-3 overflow-auto"
        onScroll={() => {
          const history = historyRef.current
          if (history) followOutput.current = history.scrollHeight - history.scrollTop - history.clientHeight < 40
        }}>
        {view.messages.map((message) => (
          <article key={message.id} className="border-b border-border-subtle pb-2">
            <p className="shrink-0 text-xs text-muted-foreground">
              {t(message.role === 'user' ? 'export.user' : 'export.assistant')}
            </p>
            <div className="whitespace-pre-wrap break-words">
              {message.data.parts
                ?.filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join('\n')}
            </div>
            {message.status === 'error' && <p role="alert">{t('side_chat.request_error')}</p>}
            {message.role === 'user' && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={busy || view.generating}
                  onClick={() =>
                    void run(async () =>
                      acceptSideChat(
                        await ipcApi.request('side_chat.retry', { topicId: view.topicId, questionId: message.id })
                      )
                    )
                  }>
                  {t('common.retry')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || view.generating}
                  onClick={() =>
                    void run(async () =>
                      acceptSideChat(
                        await ipcApi.request('side_chat.delete_question', {
                          topicId: view.topicId,
                          questionId: message.id
                        })
                      )
                    )
                  }>
                  {t('common.delete')}
                </Button>
              </div>
            )}
          </article>
        ))}
        {view.generating && <p role="status">{t('common.loading')}</p>}
      </div>
      {error && <p role="alert">{t('side_chat.request_error')}</p>}
      <Textarea.Input
        className="max-h-32 shrink-0"
        aria-label={t('side_chat.question')}
        placeholder={t('side_chat.question')}
        value={draft}
        maxLength={200000}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          disabled={busy || view.generating || !draft.trim()}
          onClick={() =>
            void run(async () => {
              const sent = draft
              acceptSideChat(await ipcApi.request('side_chat.submit', { topicId: view.topicId, text: sent }))
              clearSubmittedSideChatDraft(view.topicId, sent)
            })
          }>
          {t('chat.input.send')}
        </Button>
        {view.generating && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => acceptSideChat(await ipcApi.request('side_chat.stop', { topicId: view.topicId })))
            }>
            {t('side_chat.stop')}
          </Button>
        )}
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
