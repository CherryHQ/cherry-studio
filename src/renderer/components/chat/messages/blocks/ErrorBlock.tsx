import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { useTimer } from '@renderer/hooks/useTimer'
import { getHttpMessageLabelKey, getProviderLabelKey } from '@renderer/i18n/label'
import type { SerializedError } from '@renderer/types/error'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { classifyError } from '@renderer/utils/errorClassifier'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { useMessageListActions } from '../MessageListProvider'
import type { MessageErrorDiagnosisResult, MessageListItem } from '../types'
import { getMessageListItemModel } from '../utils/messageListItem'

const logger = loggerService.withContext('ErrorBlock')
const HTTP_ERROR_CODES = [400, 401, 403, 404, 429, 500, 502, 503, 504]

interface Props {
  partId: string
  error: SerializedError | undefined
  message: MessageListItem
  cachedDiagnosis?: MessageErrorDiagnosisResult
}

const ErrorBlock: React.FC<Props> = ({ partId, error, message, cachedDiagnosis }) => {
  return <MessageErrorInfo partId={partId} error={error} message={message} cachedDiagnosis={cachedDiagnosis} />
}

const ErrorMessage: React.FC<{ error: Props['error'] }> = ({ error }) => {
  const { t, i18n } = useTranslation()

  const i18nKey = error && 'i18nKey' in error ? `error.${(error as Record<string, unknown>).i18nKey}` : ''
  const errorKey = `error.${error?.message}`
  const errorStatus =
    error && ('status' in error || 'statusCode' in error)
      ? ((error as Record<string, unknown>).status as number | undefined) ||
        ((error as Record<string, unknown>).statusCode as number | undefined)
      : undefined

  if (i18n.exists(i18nKey)) {
    const providerId =
      error && 'providerId' in error ? ((error as Record<string, unknown>).providerId as string | undefined) : undefined
    if (providerId && typeof providerId === 'string') {
      return (
        <Trans
          i18nKey={i18nKey}
          values={{ provider: t(getProviderLabelKey(providerId)) }}
          components={{
            provider: (
              <Link style={{ color: 'var(--color-primary)' }} to="/settings/provider" search={{ id: providerId }} />
            )
          }}
        />
      )
    }
  }

  if (i18n.exists(errorKey)) {
    return t(errorKey)
  }

  if (typeof errorStatus === 'number' && HTTP_ERROR_CODES.includes(errorStatus)) {
    return (
      <span>
        {t(getHttpMessageLabelKey(errorStatus.toString()))} {error?.message}
      </span>
    )
  }

  return error?.message || ''
}

const MessageErrorInfo: React.FC<{
  partId: string
  error: Props['error']
  message: MessageListItem
  cachedDiagnosis?: MessageErrorDiagnosisResult
}> = ({ partId, error, message, cachedDiagnosis }) => {
  const { diagnoseMessageError, removeMessageErrorPart, openErrorDetail, navigateErrorTarget, notifyError } =
    useMessageListActions()
  const { setTimeoutTimer } = useTimer()
  const { t, i18n } = useTranslation()
  const [aiSummary, setAiSummary] = useState<string>('')

  const errorMessage = error?.message ?? undefined
  const errorStatus =
    (error as Record<string, unknown> | undefined)?.status ?? (error as Record<string, unknown> | undefined)?.statusCode
  const errorProviderId = (error as Record<string, unknown> | undefined)?.providerId as string | undefined
  const errorModelId = (error as Record<string, unknown> | undefined)?.modelId as string | undefined

  const providerId = getMessageListItemModel(message)?.provider ?? errorProviderId
  const classification = useMemo(
    () => classifyError(error, providerId),

    // primitives instead of the `error` object reference; `classifyError`
    // only inspects fields covered by these scalars.
    [errorMessage, errorStatus, errorProviderId, providerId]
  )

  useEffect(() => {
    if (classification.category !== 'unknown' || !errorMessage || !error || !diagnoseMessageError) return
    let cancelled = false
    diagnoseMessageError({
      message,
      partId,
      error,
      language: i18n.language
    })
      .then((result) => {
        const summary = typeof result === 'string' ? result : (result?.summary ?? '')
        if (!cancelled && summary) setAiSummary(summary)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Intentionally exclude `error` from deps — its identity changes per render
    // but the action input's scalar message/language fields are both stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classification.category, diagnoseMessageError, errorMessage, i18n.language, message, partId])

  const diagnosisContext = useMemo(
    () => ({
      errorSource: 'chat' as const,
      providerName: errorProviderId,
      modelId: errorModelId
    }),
    [errorProviderId, errorModelId]
  )

  const onRemoveErrorPart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setTimeoutTimer(
        'onRemoveErrorPart',
        async () => {
          try {
            await removeMessageErrorPart?.({ messageId: message.id, partId })
          } catch (error) {
            logger.error('Failed to dismiss message error part:', error as Error, { messageId: message.id, partId })
            notifyError?.(formatErrorMessageWithPrefix(error, t('message.error.dismiss_failed')))
          }
        },
        350
      )
    },
    [message.id, notifyError, partId, removeMessageErrorPart, setTimeoutTimer, t]
  )

  const showErrorDetail = () => {
    void openErrorDetail?.({
      message,
      error,
      partId,
      cachedDiagnosis,
      diagnosisContext
    })
  }

  const onNavigate = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (classification.navTarget) {
      void navigateErrorTarget?.(classification.navTarget)
    }
  }

  const canOpenDetail = !!openErrorDetail
  const canRemoveErrorPart = !!removeMessageErrorPart
  const canNavigate = !!classification.navTarget && !!navigateErrorTarget

  return (
    <div
      className={cn(
        'group relative my-2 rounded-lg border border-border border-l-[3px] border-l-error-border bg-transparent px-3.5 py-3 text-[13px] transition-all duration-200',
        canOpenDetail && 'cursor-pointer'
      )}
      onClick={canOpenDetail ? showErrorDetail : undefined}>
      {/* Close button */}
      {canRemoveErrorPart && (
        <button
          type="button"
          className="absolute top-2 right-2 flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-muted opacity-0 transition-all duration-150"
          onClick={onRemoveErrorPart}
          aria-label="close"
          title={t('common.close')}>
          <X size={14} />
        </button>
      )}

      {/* Header: icon + title */}
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex shrink-0 items-center justify-center text-error-base">
          <AlertTriangle size={15} className="lucide-custom" />
        </div>
        <div className="pr-5 font-medium text-[13px] leading-[1.4]">{aiSummary || t(classification.i18nKey)}</div>
      </div>

      {/* Description */}
      <div
        className="wrap-break-word ml-5.75 line-clamp-3 text-xs leading-normal [&_a]:text-primary"
        style={{ color: 'var(--color-foreground-secondary)' }}>
        {error?.message || <ErrorMessage error={error} />}
      </div>

      {/* Footer */}
      <div className="mt-2.5 ml-5.75 flex items-center gap-2">
        {canNavigate && (
          <Button
            size="sm"
            type="button"
            variant="outline"
            className="rounded-[5px] text-foreground-secondary hover:border-border-hover hover:bg-accent hover:text-foreground"
            onClick={onNavigate}>
            {t('error.diagnosis.go_to_settings')}
          </Button>
        )}
        {canOpenDetail && (
          <div
            className="ml-auto inline-flex items-center gap-0.5 text-xs transition-colors duration-150 group-hover:text-foreground"
            style={{ color: 'var(--color-foreground-muted)' }}>
            {t('common.detail')}
            <ChevronRight size={14} />
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(ErrorBlock)
