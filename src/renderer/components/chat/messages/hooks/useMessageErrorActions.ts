import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'

import { cacheService } from '@data/CacheService'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import type { ErrorDetailContentProps } from '@renderer/components/ErrorDetailModal'

const AI_CLASSIFY_TTL_MS = 60 * 60 * 1000
const aiClassifyCacheKey = (message: string, language: string) => `error.classify.${message}:${language}`

type MessageErrorActions = Pick<MessageListActions, 'diagnoseMessageError' | 'openErrorDetail' | 'navigateErrorTarget'>

interface MessageErrorActionOptions {
  diagnosticReport?: ErrorDetailContentProps['diagnosticReport']
  persistDiagnosis?: NonNullable<ErrorDetailContentProps['onDiagnosisComplete']>
}

export function useMessageErrorActions(options: MessageErrorActionOptions = {}): MessageErrorActions {
  const navigate = useNavigate()
  const { diagnosticReport, persistDiagnosis } = options

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
      showErrorDetailPopup({
        error: input.error,
        blockId: input.partId,
        cachedDiagnosis: input.cachedDiagnosis,
        diagnosisContext: input.diagnosisContext,
        diagnosticReport,
        onDiagnosisComplete: persistDiagnosis
      })
    },
    [diagnosticReport, persistDiagnosis]
  )

  const navigateErrorTarget = useCallback<NonNullable<MessageListActions['navigateErrorTarget']>>(
    (target) => {
      void navigate({ to: target })
    },
    [navigate]
  )

  return useMemo(
    () => ({
      diagnoseMessageError,
      openErrorDetail,
      navigateErrorTarget
    }),
    [diagnoseMessageError, navigateErrorTarget, openErrorDetail]
  )
}
