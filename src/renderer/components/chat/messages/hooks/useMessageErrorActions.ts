import { useCallback, useMemo } from 'react'

import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import type { ErrorDetailContentProps } from '@renderer/components/ErrorDetailModal'
import { contextFromUnknown } from '@renderer/services/AppErrorContextService'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { isAgentSessionTopic } from '@renderer/utils/agentSession'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { AppErrorContext } from '@shared/types/appError'
import type { DoctorSubjectRef } from '@shared/types/doctor'
import { projectDiagnosticAiDiagnosis } from '@shared/utils/diagnosticAi'

import type { MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'

const logger = loggerService.withContext('MessageErrorActions')
const AI_CLASSIFY_TTL_MS = 60 * 60 * 1000
// classifyErrorByAI reads the error name; a message-only key would reuse another class's summary.
const aiClassifyCacheKey = (
  error: { readonly name?: string | null; readonly message?: string | null },
  language: string
) => `error.classify.${error.name ?? ''}:${error.message ?? ''}:${language}`
export const MESSAGE_FAULT_LIMIT = 50
const messageFaults = new Map<string, AppErrorContext>()

export function resetMessageFaultsForTests(): void {
  messageFaults.clear()
}

function messageErrorSource(subject: DoctorSubjectRef | undefined, topicId: string): 'agent' | 'chat' {
  if (subject?.kind === 'agent') return 'agent'
  if (subject?.kind === 'chat') return 'chat'
  return isAgentSessionTopic(topicId) ? 'agent' : 'chat'
}

function persistedAttemptTime(message: { createdAt: string; updatedAt?: string }): string | undefined {
  for (const candidate of [message.updatedAt, message.createdAt]) {
    if (!candidate || Number.isNaN(Date.parse(candidate))) continue
    return new Date(candidate).toISOString()
  }
  return undefined
}

function localModelId(id: string | undefined): string | undefined {
  if (!id) return undefined
  return isUniqueModelId(id) ? parseUniqueModelId(id).modelId : id
}

function messageFaultKey(
  message: MessageListItem,
  partId: string,
  error:
    | {
        readonly name?: string | null
        readonly message?: string | null
        readonly statusCode?: number | null
        readonly responseBody?: unknown
      }
    | undefined
): string {
  const response = typeof error?.responseBody === 'string' ? error.responseBody.slice(0, 240) : ''
  return [
    message.id,
    partId,
    message.updatedAt ?? '',
    error?.name ?? '',
    error?.message ?? '',
    error?.statusCode ?? '',
    response
  ].join('\0')
}

function rememberMessageFault(key: string, create: () => AppErrorContext): AppErrorContext {
  const cached = messageFaults.get(key)
  if (cached) {
    messageFaults.delete(key)
    messageFaults.set(key, cached)
    return cached
  }
  const created = create()
  messageFaults.set(key, created)
  while (messageFaults.size > MESSAGE_FAULT_LIMIT) {
    const oldest = messageFaults.keys().next().value
    if (oldest === undefined) break
    messageFaults.delete(oldest)
  }
  return created
}

type MessageErrorActions = Pick<MessageListActions, 'diagnoseMessageError' | 'openErrorDetail' | 'navigateErrorTarget'>

interface MessageErrorActionOptions {
  diagnosticReport?: ErrorDetailContentProps['diagnosticReport']
  getDoctorSubject: (message: MessageListItem) => DoctorSubjectRef | undefined
}

export function useMessageErrorActions(options: MessageErrorActionOptions): MessageErrorActions {
  const { diagnosticReport, getDoctorSubject } = options

  const diagnoseMessageError = useCallback<NonNullable<MessageListActions['diagnoseMessageError']>>(
    ({ error, language }) => {
      const errorMessage = error.message
      if (!errorMessage) return Promise.resolve(null)

      const cacheKey = aiClassifyCacheKey(error, language)
      const cached = cacheService.getCasual<Promise<string>>(cacheKey)
      if (cached) return cached

      const promise = import('@renderer/utils/errorDiagnosis')
        .then(({ classifyErrorByAI }) => classifyErrorByAI(error, language))
        .catch((classificationError) => {
          cacheService.deleteCasual(cacheKey)
          throw classificationError
        })
      cacheService.setCasual<Promise<string>>(cacheKey, promise, AI_CLASSIFY_TTL_MS)
      return promise
    },
    []
  )

  const openErrorDetail = useCallback<NonNullable<MessageListActions['openErrorDetail']>>(
    async (input) => {
      const { showErrorDetailPopup } = await import('@renderer/components/ErrorDetailModal')
      const model = getMessageListItemModel(input.message)
      const occurredAt = persistedAttemptTime(input.message)
      const message = input.error?.message || input.localizedErrorMessage || ''
      const subject = getDoctorSubject(input.message)
      const faultKey = messageFaultKey(input.message, input.partId, input.error)
      const modelId = localModelId(model?.id)
      const errorContext = rememberMessageFault(faultKey, () =>
        contextFromUnknown(input.error ?? message, {
          source: messageErrorSource(subject, input.message.topicId),
          operation: 'message.error',
          message,
          ...(occurredAt ? { occurredAt } : {}),
          ...(model?.provider ? { providerId: model.provider } : {}),
          ...(modelId ? { modelId } : {}),
          recordId: input.message.id,
          params: { partId: input.partId, topicId: input.message.topicId }
        })
      )
      const legacyDiagnosis = input.aiSummary
        ? projectDiagnosticAiDiagnosis({
            source: 'error-summary',
            status: 'completed',
            text: input.aiSummary,
            errorId: errorContext.id
          })
        : undefined
      try {
        await showErrorDetailPopup({
          error: input.error,
          errorContext,
          subject,
          incident: { topicId: input.message.topicId, messageId: input.message.id, errorId: errorContext.id },
          diagnosisContext: { providerId: model?.provider, modelId: model?.id },
          localizedErrorMessage: input.localizedErrorMessage,
          ...(legacyDiagnosis ? { aiDiagnosis: legacyDiagnosis } : {}),
          diagnosticReport
        })
      } catch (error) {
        logger.error('Failed to open the message error detail', error as Error)
      }
    },
    [diagnosticReport, getDoctorSubject]
  )

  const navigateErrorTarget = useCallback<NonNullable<MessageListActions['navigateErrorTarget']>>((target) => {
    openRoute(target)
  }, [])

  return useMemo(
    () => ({
      diagnoseMessageError,
      openErrorDetail,
      navigateErrorTarget
    }),
    [diagnoseMessageError, navigateErrorTarget, openErrorDetail]
  )
}
