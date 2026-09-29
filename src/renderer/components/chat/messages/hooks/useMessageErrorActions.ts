import { useCallback, useMemo } from 'react'

import { cacheService } from '@data/CacheService'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import type { ErrorDetailContentProps } from '@renderer/components/ErrorDetailModal'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import type { DoctorSubjectRef } from '@shared/types/doctor'

import type { MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'

const AI_CLASSIFY_TTL_MS = 60 * 60 * 1000
const aiClassifyCacheKey = (message: string, language: string) => `error.classify.${message}:${language}`

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

      const cacheKey = aiClassifyCacheKey(errorMessage, language)
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
      showErrorDetailPopup({
        error: input.error,
        subject: getDoctorSubject(input.message),
        diagnosisContext: { providerId: model?.provider, modelId: model?.id },
        localizedErrorMessage: input.localizedErrorMessage,
        diagnosticReport
      })
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
