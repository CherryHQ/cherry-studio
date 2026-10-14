import { useCallback, useEffect, useMemo, useRef } from 'react'

import { dataApiService } from '@data/DataApiService'
import { useCommandRuntime } from '@renderer/hooks/command'
import i18n from '@renderer/i18n/resolver'
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
  resolve: (success: boolean) => void
  reject: (error: unknown) => void
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
      state.pending?.resolve(false)
      state.pending = undefined
      state.waiting.forEach((completion) => completion.resolve(false))
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
        if (state.attempts.has(key)) continue
        state.attempts.add(key)
        if (state.pending && (!state.pending.modelId || state.pending.modelId === execution.executionId)) {
          state.waiting.set(key, state.pending)
          state.pending = undefined
        }
      }
    },
    [state]
  )

  const waitForFinish = useCallback(
    (run: () => Promise<void | boolean>, modelId?: string): Promise<boolean> => {
      if (!state.active || state.pending) return Promise.resolve(false)
      return new Promise<boolean>((resolve, reject) => {
        const completion: Completion = { modelId, resolve, reject }
        state.pending = completion
        void Promise.resolve()
          .then(run)
          .then((accepted) => {
            if (accepted === false) {
              if (state.pending === completion) state.pending = undefined
              resolve(false)
            }
          })
          .catch((error) => {
            if (state.pending === completion) state.pending = undefined
            for (const [key, value] of state.waiting) if (value === completion) state.waiting.delete(key)
            reject(error)
          })
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
      if (!state.active || !state.attempts.delete(key)) return
      const error = event.message.parts.findLast((part) => part.type === 'data-error')?.data
      const completion = state.waiting.get(key)
      state.waiting.delete(key)
      if (completion) {
        if (event.isAbort) completion.resolve(false)
        else if (event.isError || error) completion.reject(error ?? new Error(i18n.t('error.diagnosis.stream')))
        else completion.resolve(true)
        return
      }
      if (!event.isAbort && (event.isError || error))
        void report(error ?? new Error(i18n.t('error.diagnosis.stream')), executionId, event.message)
    },
    [report, state]
  )

  return { track, report, onFinish, waitForFinish }
}
