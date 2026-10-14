import { useCallback, useEffect, useMemo, useRef } from 'react'

import { dataApiService } from '@data/DataApiService'
import { useCommandRuntime } from '@renderer/hooks/command'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { ExecutionFinishEvent } from '@renderer/services/aiTransport'
import { toast, type ErrorToastContext } from '@renderer/services/toast'
import { getProviderDisplayName } from '@renderer/utils/naming'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

interface RecoveryActions {
  retry?: (message: CherryUIMessage, modelId: UniqueModelId) => Promise<void>
  trimContext?: () => Promise<void | boolean>
}

interface Completion {
  modelId?: string
  key?: string
  finish: (key: string, result: { success: boolean; error?: unknown }) => void
  cancel: () => void
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
      attempts: new Set<string>(),
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

  const track = useCallback(
    (executions: readonly ActiveExecution[] = []) => {
      if (!state.active) return
      for (const execution of executions) {
        const key = `${execution.executionId}:${execution.attemptId}`
        if (state.waiting.has(key)) continue
        const pending = state.pending
        if (pending && (!pending.modelId || pending.modelId === execution.executionId)) {
          pending.key = key
          state.waiting.set(key, pending)
          state.pending = undefined
        } else {
          state.attempts.add(key)
        }
      }
    },
    [state]
  )

  const waitForFinish = useCallback(
    (run: () => Promise<void | boolean>, modelId?: string): Promise<boolean> => {
      if (!state.active || state.pending) return Promise.resolve(false)
      const unsubscribers: Array<() => void> = []
      let completion: Completion
      return new Promise<boolean>((resolve, reject) => {
        const results = new Map<string, { success: boolean; error?: unknown }>()
        let accepted = false
        const settle = () => {
          const result = accepted && completion.key ? results.get(completion.key) : undefined
          if (!result) return
          if (result.error !== undefined) reject(result.error)
          else resolve(result.success)
        }
        completion = {
          modelId,
          cancel: () => resolve(false),
          finish: (key, result) => {
            if (!state.active || (state.pending !== completion && state.waiting.get(key) !== completion)) return
            results.set(key, result)
            settle()
          }
        }
        state.pending = completion
        // Main can finish before its acknowledgement or before an overlay reader starts.
        // Keep terminal outcomes until the acknowledgement identifies the accepted attempt.
        unsubscribers.push(
          ipcApi.on('ai.stream.done', (event) => {
            if (event.topicId !== state.scopeKey || !event.executionId || event.attemptId === undefined) return
            if (modelId && event.executionId !== modelId) return
            completion.finish(`${event.executionId}:${event.attemptId}`, { success: event.status === 'success' })
          }),
          ipcApi.on('ai.stream.error', (event) => {
            if (event.topicId !== state.scopeKey || !event.executionId || event.attemptId === undefined) return
            if (modelId && event.executionId !== modelId) return
            completion.finish(`${event.executionId}:${event.attemptId}`, { success: false, error: event.error })
          })
        )
        void Promise.resolve()
          .then(() => (state.active && state.pending === completion ? run() : false))
          .then((started) => {
            if (started === false || !completion.key) return resolve(false)
            accepted = true
            settle()
          })
          .catch(reject)
      }).finally(() => {
        unsubscribers.forEach((unsubscribe) => unsubscribe())
        if (state.pending === completion) state.pending = undefined
        if (completion.key && state.waiting.get(completion.key) === completion) state.waiting.delete(completion.key)
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

  const onFinish = useCallback(
    (executionId: string, event: ExecutionFinishEvent) => {
      const key = `${executionId}:${event.attemptId}`
      if (!state.active) return
      const error = event.message.parts.findLast((part) => part.type === 'data-error')?.data
      const completion = state.waiting.get(key) ?? state.pending
      if (completion && (!completion.modelId || completion.modelId === executionId)) {
        completion.finish(key, {
          success: !event.isAbort,
          error:
            !event.isAbort && (event.isError || error)
              ? (error ?? new Error(i18n.t('error.diagnosis.stream')))
              : undefined
        })
        if (completion.key === key) return
      }
      if (!state.attempts.delete(key)) return
      if (!event.isAbort && (event.isError || error))
        void report(error ?? new Error(i18n.t('error.diagnosis.stream')), executionId, event.message)
    },
    [report, state]
  )

  return { track, report, onFinish, waitForFinish }
}
