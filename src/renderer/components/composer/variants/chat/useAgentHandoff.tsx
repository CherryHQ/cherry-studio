import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea
} from '@cherrystudio/ui'
import type { ComposerSerializedDraft, ComposerSerializedToken } from '@renderer/components/composer/tokens'
import { DefaultModelSelector } from '@renderer/components/DefaultModelSelector'
import { StaticMarkdown } from '@renderer/components/markdown'
import { WorkspaceSelector } from '@renderer/components/resourceCatalog/selectors'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { buildFilePartsForAttachments } from '@renderer/utils/file/buildFileParts'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { UniqueModelId } from '@shared/data/types/model'
import type { HandoffDraftOpenResponse, HandoffStart, HandoffStartResponse } from '@shared/ipc/schemas/ai'
import { isNonChatModel } from '@shared/utils/model'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { findAgentHandoffToken, getAgentHandoffTokenPayload } from './agentHandoffToken'

export interface AgentHandoffTarget {
  agentId: string
  name: string
  description?: string
}

export interface AgentHandoffSource {
  kind: 'topic' | 'temporary'
  id: string
  name?: string
}

interface HandoffState {
  phase: 'idle' | 'generating' | 'ready' | 'starting' | 'complete' | 'error'
  source?: AgentHandoffSource
  target?: AgentHandoffTarget
  handoffId?: string
  task: string
  summary: string
  streamId?: string
  metadata?: HandoffDraftOpenResponse
  result?: HandoffStartResponse
  error?: string
  attachments: ComposerAttachment[]
  workspaceId: string | null
  excludedAttachments: string[]
  submitted: boolean
  summaryModelId?: UniqueModelId
}

const initialState: HandoffState = {
  phase: 'idle',
  task: '',
  summary: '',
  attachments: [],
  workspaceId: null,
  excludedAttachments: [],
  submitted: false
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message
  return String(error)
}

export function useAgentHandoff({ onStarted, sourceId }: { onStarted?: () => void; sourceId?: string } = {}) {
  const { t } = useTranslation()
  const navigation = useConversationNavigation('agents')
  const taskId = useId()
  const summaryId = useId()
  const [state, setState] = useState<HandoffState>(initialState)
  const [editingSummary, setEditingSummary] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const { model: summaryModel } = useModelById(state.metadata?.modelId ?? state.summaryModelId)
  const { providers } = useProviders(undefined, { enabled: state.phase !== 'idle' })
  const stateRef = useRef(state)
  stateRef.current = state
  const generationRef = useRef(0)
  const streamIdRef = useRef<string | undefined>(undefined)
  const startingRef = useRef(false)
  const submittedRequestRef = useRef<HandoffStart | undefined>(undefined)

  useIpcOn('ai.stream.chunk', ({ topicId, chunk }) => {
    if (topicId !== streamIdRef.current || stateRef.current.phase !== 'generating') return
    if (chunk.type !== 'text-delta') return
    setState((current) =>
      current.streamId === topicId ? { ...current, summary: current.summary + chunk.delta } : current
    )
  })
  useIpcOn('ai.stream.done', ({ topicId, status }) => {
    if (topicId !== streamIdRef.current) return
    setState((current) =>
      current.streamId !== topicId
        ? current
        : status === 'success'
          ? { ...current, phase: 'ready' }
          : { ...current, phase: 'error', error: t('agent.session.handoff.generation_stopped') }
    )
  })
  useIpcOn('ai.stream.error', ({ topicId, error }) => {
    if (topicId !== streamIdRef.current) return
    setState((current) =>
      current.streamId === topicId ? { ...current, phase: 'error', error: error.message ?? t('common.error') } : current
    )
  })

  useEffect(() => {
    if (state.phase !== 'generating') return
    const startedAt = Date.now()
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [state.phase, state.streamId])

  const abort = useCallback((streamId: string) => {
    void ipcApi.request('ai.stream.abort', { topicId: streamId }).catch(() => undefined)
  }, [])

  const cancel = useCallback(() => {
    ++generationRef.current
    const streamId = streamIdRef.current
    if (streamId) abort(streamId)
    streamIdRef.current = undefined
    startingRef.current = false
    submittedRequestRef.current = undefined
    setState(initialState)
  }, [abort])

  const open = useCallback(
    (
      draft: ComposerSerializedDraft,
      target: AgentHandoffTarget,
      source: AgentHandoffSource,
      attachments: ComposerAttachment[],
      options?: {
        summaryModelId?: UniqueModelId
        workspaceId?: string | null
        excludedAttachments?: string[]
        handoffId?: string
      }
    ) => {
      cancel()
      setEditingSummary(false)
      setElapsedSeconds(0)
      const generation = ++generationRef.current
      const streamId = `handoff:draft:${crypto.randomUUID()}`
      const handoffId = options?.handoffId ?? crypto.randomUUID()
      streamIdRef.current = streamId
      setState({
        phase: 'generating',
        source,
        target,
        handoffId,
        task: draft.text.trim(),
        summary: '',
        streamId,
        attachments,
        workspaceId: options?.workspaceId ?? null,
        excludedAttachments: options?.excludedAttachments ?? [],
        submitted: false,
        summaryModelId: options?.summaryModelId
      })
      void ipcApi
        .request('ai.agent.handoff.draft.open', {
          sourceSessionId: source.id,
          task: draft.text.trim(),
          targetAgentId: target.agentId,
          ...(options?.summaryModelId ? { summaryModelId: options.summaryModelId } : {}),
          streamId
        })
        .then((metadata) => {
          if (generation !== generationRef.current || streamIdRef.current !== streamId) {
            abort(streamId)
            return
          }
          setState((current) => (current.streamId === streamId ? { ...current, metadata } : current))
        })
        .catch((error) => {
          if (generation === generationRef.current && streamIdRef.current === streamId) {
            setState((current) => ({ ...current, phase: 'error', error: errorMessage(error) }))
          }
        })
    },
    [abort, cancel]
  )

  const start = useCallback(async () => {
    const current = stateRef.current
    if (startingRef.current || !current.source || !current.target || !current.handoffId || !current.task.trim()) return
    if (current.phase !== 'ready' && current.phase !== 'error') return
    const generation = generationRef.current
    startingRef.current = true
    setState((value) => ({ ...value, phase: 'starting', error: undefined }))
    try {
      if (!submittedRequestRef.current) {
        const files = current.attachments.filter(
          (file) => !current.excludedAttachments.includes(file.fileTokenSourceId)
        )
        const attachmentParts = [
          ...(current.metadata?.attachments ?? []).filter((part) => !current.excludedAttachments.includes(part.url)),
          ...(await buildFilePartsForAttachments(files))
        ]
        if (generation !== generationRef.current) return
        // Freeze the request before IPC: a lost response must retry the same confirmation.
        submittedRequestRef.current = {
          handoffId: current.handoffId,
          source: current.source,
          targetAgentId: current.target.agentId,
          workspace: current.workspaceId ? { type: 'user', workspaceId: current.workspaceId } : { type: 'system' },
          goal: current.task,
          summary: current.summary,
          attachmentParts
        }
        setState((value) => ({ ...value, submitted: true }))
      }
      const result = await ipcApi.request('ai.agent.handoff.start', submittedRequestRef.current)
      if (generation !== generationRef.current) return
      if (result.error && result.state !== 'started') {
        setState((value) => ({ ...value, phase: 'error', result, error: errorMessage(result.error) }))
        return
      }
      onStarted?.()
      setState((value) => ({ ...value, phase: 'complete', result }))
    } catch (error) {
      if (generation === generationRef.current) {
        setState((value) => ({ ...value, phase: 'error', error: errorMessage(error) }))
      }
    } finally {
      if (generation === generationRef.current) startingRef.current = false
    }
  }, [onStarted])

  // Navigate after the source's cleared draft has committed, before it persists on unmount.
  useEffect(() => {
    if (state.phase !== 'complete' || !state.result) return
    if (sourceId && state.source?.id !== sourceId) return
    navigation.openConversation(state.result.sessionId, state.target?.name)
    cancel()
  }, [cancel, navigation, sourceId, state.phase, state.result, state.source?.id, state.target?.name])

  useEffect(() => cancel, [cancel, sourceId])

  const close = useCallback(() => {
    if (!startingRef.current || !submittedRequestRef.current) cancel()
  }, [cancel])

  const regenerate = (summaryModelId?: UniqueModelId) => {
    const current = stateRef.current
    if (!current.source || !current.target || current.submitted || !current.task.trim()) return
    open({ text: current.task, tokens: [] }, current.target, current.source, current.attachments, {
      summaryModelId: summaryModelId ?? current.summaryModelId,
      workspaceId: current.workspaceId,
      excludedAttachments: current.excludedAttachments,
      handoffId: current.handoffId
    })
  }
  const handleSummaryModelSelect = (model: { id: UniqueModelId } | undefined) => {
    if (!model || inputDisabled) return
    regenerate(model.id)
  }
  const inputDisabled = state.phase === 'generating' || state.phase === 'starting' || state.submitted
  const choices = [
    ...(state.metadata?.attachments ?? []).map((part) => ({
      id: part.url,
      name: part.filename ?? t('agent.session.handoff.attachment')
    })),
    ...state.attachments.map((file) => ({ id: file.fileTokenSourceId, name: file.origin_name || file.name }))
  ]

  const dialog =
    state.phase !== 'idle' && state.source && state.target ? (
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('agent.session.handoff.title', { agent: state.target.name })}</DialogTitle>
            <DialogDescription>{t('agent.session.handoff.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block font-medium text-sm" htmlFor={taskId}>
              {t('agent.session.handoff.goal')}
            </label>
            <Textarea.Input
              id={taskId}
              value={state.task}
              onChange={(event) => setState((value) => ({ ...value, task: event.target.value }))}
              disabled={inputDisabled}
            />
            <div className="flex items-center justify-between gap-2">
              <label
                className="font-medium text-sm"
                id={`${summaryId}-label`}
                htmlFor={editingSummary ? summaryId : undefined}>
                {t('agent.session.handoff.summary')}
              </label>
              <Button
                variant="ghost"
                size="sm"
                disabled={inputDisabled}
                onClick={() => setEditingSummary((value) => !value)}>
                {t(editingSummary ? 'common.preview' : 'common.edit')}
              </Button>
            </div>
            {state.phase === 'generating' ? (
              <p role="status" className="text-muted-foreground text-sm">
                {t('agent.session.handoff.generating', { seconds: elapsedSeconds })}
              </p>
            ) : null}
            {editingSummary ? (
              <Textarea.Input
                className="max-h-80 min-h-40"
                id={summaryId}
                value={state.summary}
                onChange={(event) => setState((value) => ({ ...value, summary: event.target.value }))}
                disabled={inputDisabled}
              />
            ) : (
              <div
                role="region"
                aria-labelledby={`${summaryId}-label`}
                aria-busy={state.phase === 'generating'}
                className="max-h-80 min-h-40 overflow-y-auto rounded-md border border-border p-3 text-sm">
                {state.phase === 'generating' ? (
                  <p className="whitespace-pre-wrap">{state.summary}</p>
                ) : (
                  <StaticMarkdown id={summaryId}>{state.summary}</StaticMarkdown>
                )}
              </div>
            )}
            <WorkspaceSelector
              value={state.workspaceId}
              onChange={(workspaceId) => setState((value) => ({ ...value, workspaceId }))}
              trigger={
                <Button type="button" variant="outline" disabled={inputDisabled}>
                  {state.workspaceId ?? t('agent.session.group.no_workdir')}
                </Button>
              }
            />
            <fieldset disabled={inputDisabled} className="space-y-2">
              <legend className="font-medium text-sm">{t('agent.session.handoff.summary_model')}</legend>
              <DefaultModelSelector
                model={summaryModel}
                providers={providers}
                placeholder={t('settings.models.quick_model.label')}
                filter={(model) => !isNonChatModel(model)}
                onSelect={handleSummaryModelSelect}
              />
            </fieldset>
            {state.metadata ? (
              <p className="text-muted-foreground text-xs">
                {t('agent.session.handoff.coverage', {
                  count: state.metadata.messageCount,
                  attachments: state.metadata.attachments.length
                })}
              </p>
            ) : null}
            <p className="break-all text-muted-foreground text-xs">
              {t('agent.session.handoff.source')}: {state.source.name || state.source.id}
            </p>
            {choices.length > 0 ? (
              <fieldset className="space-y-2" disabled={inputDisabled}>
                <legend className="mb-2 font-medium text-sm">{t('agent.session.handoff.attachments')}</legend>
                {choices.map((file) => (
                  <label key={file.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      disabled={inputDisabled}
                      checked={!state.excludedAttachments.includes(file.id)}
                      onCheckedChange={(checked) =>
                        setState((value) => ({
                          ...value,
                          excludedAttachments: checked
                            ? value.excludedAttachments.filter((id) => id !== file.id)
                            : [...value.excludedAttachments, file.id]
                        }))
                      }
                    />
                    <span className="truncate">{file.name}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {state.error ? (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={state.phase === 'starting' && state.submitted} onClick={close}>
              {t('common.cancel')}
            </Button>
            {state.result?.sessionId ? (
              <Button
                variant="outline"
                onClick={() => navigation.openConversation(state.result!.sessionId, state.target?.name)}>
                {t('agent.session.handoff.open_agent')}
              </Button>
            ) : null}
            {!state.submitted ? (
              <Button variant="outline" disabled={inputDisabled || !state.task.trim()} onClick={() => regenerate()}>
                {t('common.regenerate')}
              </Button>
            ) : null}
            <Button
              disabled={(state.phase !== 'ready' && state.phase !== 'error') || !state.task.trim()}
              loading={state.phase === 'generating' || state.phase === 'starting'}
              onClick={() => void start()}>
              {t(state.submitted && state.phase === 'error' ? 'common.retry' : 'agent.session.handoff.start')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null

  return { open, dialog }
}

export function getHandoffTarget(tokens: readonly ComposerSerializedToken[]) {
  const token = findAgentHandoffToken(tokens)
  return token ? getAgentHandoffTokenPayload(token) : null
}
