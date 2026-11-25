import { useCallback, useMemo } from 'react'

import type { MessageListActions } from '@renderer/components/chat/messages/types'
import type { ErrorDetailContentProps } from '@renderer/components/ErrorDetailModal'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import type { DoctorSubjectRef } from '@shared/types/doctor'

import type { MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'

type MessageErrorActions = Pick<MessageListActions, 'diagnoseMessageError' | 'openErrorDetail' | 'navigateErrorTarget'>

interface MessageErrorActionOptions {
  diagnosticReport?: ErrorDetailContentProps['diagnosticReport']
  getDoctorSubject: (message: MessageListItem) => DoctorSubjectRef | undefined
}

export function useMessageErrorActions(options: MessageErrorActionOptions): MessageErrorActions {
  const { diagnosticReport, getDoctorSubject } = options

  const diagnoseMessageError = useCallback<NonNullable<MessageListActions['diagnoseMessageError']>>(
    async ({ error, language }) => {
      if (!error.message) return null
      const { classifyErrorByAI } = await import('@renderer/utils/errorDiagnosis')
      return classifyErrorByAI(error, language)
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
        incident: { topicId: input.message.topicId, messageId: input.message.id },
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
