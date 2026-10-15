import { useCallback, useEffect, useMemo, useRef } from 'react'

import { dataApiService } from '@data/DataApiService'
import { useCommandRuntime } from '@renderer/hooks/command'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { ExecutionFinishEvent } from '@renderer/services/aiTransport'
import { toast, type ErrorToastContext } from '@renderer/services/toast'
import { getProviderDisplayName } from '@renderer/utils/naming'
import type { ActiveExecution, StreamDonePayload, StreamErrorPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

interface RecoveryActions {
  retry?: (message: CherryUIMessage, modelId: UniqueModelId) => Promise<void>
  trimContext?: () => Promise<void | boolean>
}

interface Completion {
  modelId?: string
  key?: string
  finish: (result: { success: boolean; error?: unknown }) => void
  cancel: () => void
}

interface Attempt {
  accepted?: boolean
  handled?: boolean
  message?: CherryUIMessage
  result?: { success: boolean; error?: unknown }
}

export function useConversationErrorToasts(scopeKey: string, actions: RecoveryActions = {}) {
  const commands = useCommandRuntime()
  const latest = useRef({ actions, commands })
  latest.current = { actions, commands }
  const state = useMemo(
    () => ({
      scopeKey,
      active: true,
      generation: 0,
      attempts: new Map<string, Attempt>(),
      keys: new Set<string>(),
      waiting: new Map<string, Completion>(),
      pending: undefined as Completion | undefined
    }),
    [scopeKey]
  )

  useEffect(() => {
    state.active = true
    return () => {
      state.active = false
      state.generation += 1
      state.keys.forEach((key) => toast.closeToast(key))
      state.pending?.cancel()
      state.pending = undefined
      state.waiting.forEach((completion) => completion.cancel())
      state.waiting.clear()
      state.attempts.clear()
      state.keys.clear()
    }
  }, [state])

  const waitForFinish = useCallback(
    (run: () => Promise<void | boolean>, modelId?: string): Promise<boolean> => {
      if (!state.active || state.pending) return Promise.resolve(false)
      let completion: Completion
      return new Promise<boolean>((resolve, reject) => {
        let result: Attempt['result']
        let accepted = false
        const settle = () => {
          if (!accepted || !result) return
          if (result.error !== undefined) reject(result.error)
          else resolve(result.success)
        }
        completion = {
          modelId,
          cancel: () => resolve(false),
          finish: (outcome) => {
            result = outcome
            settle()
          }
        }
        state.pending = completion
        void Promise.resolve()
          .then(() => (state.active && state.pending === completion ? run() : false))
          .then((started) => {
            if (started === false || !completion.key) return resolve(false)
            accepted = true
            settle()
          })
          .catch(reject)
      }).finally(() => {
        if (state.pending === completion) state.pending = undefined
        if (completion.key && state.waiting.get(completion.key) === completion) {
          state.waiting.delete(completion.key)
          state.attempts.set(completion.key, { accepted: true, handled: true })
        }
      })
    },
    [state]
  )

  const report = useCallback(
    async (error: unknown, modelId?: string, message?: CherryUIMessage) => {
      if (!state.active) return
      const generation = state.generation
      const identity = modelId && isUniqueModelId(modelId) ? parseUniqueModelId(modelId) : undefined
      const provider = identity
        ? await dataApiService.get(`/providers/${identity.providerId}`).catch(() => undefined)
        : undefined
      if (!state.active || generation !== state.generation) return
      const key = `error:${state.scopeKey}:${message?.id ?? modelId ?? 'send'}`
      state.keys.add(key)
      const recovery: ErrorToastContext['actions'] = {
        trimContext: latest.current.actions.trimContext ? () => latest.current.actions.trimContext?.() : undefined,
        switchModel:
          identity && latest.current.commands.hasHandler('chat.model.select')
            ? () => latest.current.commands.execute('chat.model.select', { providerId: identity.providerId })
            : undefined,
        retry:
          message?.id &&
          message.metadata?.parentId &&
          modelId &&
          isUniqueModelId(modelId) &&
          latest.current.actions.retry
            ? () => waitForFinish(() => latest.current.actions.retry!(message, modelId), modelId)
            : undefined
      }
      toast.errorFromException(error, {
        key,
        provider: provider
          ? { ...provider, name: getProviderDisplayName(provider) }
          : identity
            ? { id: identity.providerId, name: identity.providerId }
            : undefined,
        modelName: message?.metadata?.messageSnapshot?.model?.name ?? identity?.modelId,
        actions: recovery,
        isCurrent: () => state.active && generation === state.generation
      })
    },
    [state, waitForFinish]
  )

  const finishAttempt = useCallback(
    (executionId: string, key: string, attempt: Attempt) => {
      if (!attempt.accepted || !attempt.result || attempt.handled) return
      state.attempts.set(key, { accepted: true, handled: true })
      const completion = state.waiting.get(key)
      if (completion) completion.finish(attempt.result)
      else if (attempt.result.error !== undefined) void report(attempt.result.error, executionId, attempt.message)
    },
    [report, state]
  )

  const track = useCallback(
    (executions: readonly ActiveExecution[] = [], messages: readonly CherryUIMessage[] = []) => {
      if (!state.active) return
      for (const execution of executions) {
        const key = `${execution.executionId}:${execution.attemptId}`
        const attempt = state.attempts.get(key) ?? {}
        if (attempt.accepted) continue
        attempt.accepted = true
        attempt.message = messages.find((message) => message.id === execution.anchorMessageId) ?? attempt.message
        state.attempts.set(key, attempt)
        const pending = state.pending
        if (pending && (!pending.modelId || pending.modelId === execution.executionId)) {
          pending.key = key
          state.waiting.set(key, pending)
          state.pending = undefined
        }
        finishAttempt(execution.executionId, key, attempt)
      }
    },
    [finishAttempt, state]
  )

  const onFinish = useCallback(
    (executionId: string, event: ExecutionFinishEvent) => {
      if (!state.active) return
      const key = `${executionId}:${event.attemptId}`
      const attempt = state.attempts.get(key) ?? {}
      if (attempt.handled) return
      const error = event.message.parts.findLast((part) => part.type === 'data-error')?.data
      attempt.result = {
        success: !event.isAbort,
        error:
          !event.isAbort && (event.isError || error)
            ? (error ?? new Error(i18n.t('error.diagnosis.stream')))
            : undefined
      }
      attempt.message ??= { ...event.message, parts: [] }
      state.attempts.set(key, attempt)
      finishAttempt(executionId, key, attempt)
    },
    [finishAttempt, state]
  )

  useEffect(() => {
    // Terminal events may precede acknowledgement or overlay startup. Only locally
    // accepted attempts produce feedback; late overlay callbacks share the same deduplication.
    const onTerminal = (event: StreamDonePayload | StreamErrorPayload) => {
      if (event.topicId !== state.scopeKey || !event.executionId || event.attemptId === undefined) return
      const error = 'error' in event ? event.error : undefined
      onFinish(event.executionId, {
        attemptId: event.attemptId,
        message: {
          id: event.anchorMessageId ?? '',
          role: 'assistant',
          parts: error ? [{ type: 'data-error', data: error }] : []
        },
        isError: error !== undefined,
        isAbort: 'status' in event && event.status === 'paused'
      })
    }
    const offDone = ipcApi.on('ai.stream.done', onTerminal)
    const offError = ipcApi.on('ai.stream.error', onTerminal)
    return () => {
      offDone()
      offError()
    }
  }, [onFinish, state])

  return { track, report, onFinish, waitForFinish }
}
