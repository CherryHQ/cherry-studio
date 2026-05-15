import { cacheService } from '@data/CacheService'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import { classifyErrorByAI } from '@renderer/services/ErrorDiagnosisService'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'

const AI_CLASSIFY_TTL_MS = 60 * 60 * 1000
const aiClassifyCacheKey = (message: string, language: string) => `error.classify.${message}:${language}`

type MessageErrorActions = Pick<MessageListActions, 'diagnoseMessageError' | 'openErrorDetail' | 'navigateErrorTarget'>

export function useMessageErrorActions(): MessageErrorActions {
  const navigate = useNavigate()

  const diagnoseMessageError = useCallback<NonNullable<MessageListActions['diagnoseMessageError']>>(
    ({ error, language }) => {
      const errorMessage = error.message
      if (!errorMessage) return Promise.resolve(null)

      const cacheKey = aiClassifyCacheKey(errorMessage, language)
      const cached = cacheService.getCasual<Promise<string>>(cacheKey)
      if (cached) return cached

      const promise = classifyErrorByAI(error, language)
      cacheService.setCasual<Promise<string>>(cacheKey, promise, AI_CLASSIFY_TTL_MS)
      return promise
    },
    []
  )

  const openErrorDetail = useCallback<NonNullable<MessageListActions['openErrorDetail']>>((input) => {
    showErrorDetailPopup({
      error: input.error,
      blockId: input.partId,
      cachedDiagnosis: input.cachedDiagnosis,
      diagnosisContext: input.diagnosisContext
    })
  }, [])

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
