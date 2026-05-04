import { SettingOutlined } from '@ant-design/icons'
import { Button } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import { useTimer } from '@renderer/hooks/useTimer'
import { getHttpMessageLabel, getProviderLabel } from '@renderer/i18n/label'
import type { DiagnosisResult } from '@renderer/services/ErrorDiagnosisService'
import { classifyErrorByAI } from '@renderer/services/ErrorDiagnosisService'
import type { SerializedError } from '@renderer/types/error'
import type { Message } from '@renderer/types/newMessage'
import { classifyError } from '@renderer/utils/errorClassifier'
import type { CherryMessagePart } from '@shared/data/types/message'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { useRefresh } from './V2Contexts'

const logger = loggerService.withContext('ErrorBlock')

const HTTP_ERROR_CODES = [400, 401, 403, 404, 429, 500, 502, 503, 504]

// Module-level cache for AI classification to avoid duplicate API calls
const aiClassifyCache = new Map<string, Promise<string>>()

interface Props {
  partId: string
  error: SerializedError | undefined
  message: Message
  cachedDiagnosis?: DiagnosisResult
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
          values={{ provider: getProviderLabel(providerId) }}
          components={{
            provider: (
              <Link style={{ color: 'var(--color-link)' }} to="/settings/provider" search={{ id: providerId }} />
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
        {getHttpMessageLabel(errorStatus.toString())} {error?.message}
      </span>
    )
  }

  return error?.message || ''
}

const MessageErrorInfo: React.FC<{
  partId: string
  error: Props['error']
  message: Message
  cachedDiagnosis?: DiagnosisResult
}> = ({ partId, error, message, cachedDiagnosis }) => {
  const refresh = useRefresh()
  const { setTimeoutTimer } = useTimer()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [aiSummary, setAiSummary] = useState<string>('')

  const providerId =
    message.model?.provider ?? ((error as Record<string, unknown> | undefined)?.providerId as string | undefined)
  const classification = useMemo(() => classifyError(error, providerId), [error, providerId])

  const errorMessage = error?.message
  useEffect(() => {
    if (classification.category !== 'unknown' || !errorMessage || !error) return
    let cancelled = false
    const cacheKey = `${errorMessage}:${i18n.language}`
    const cached = aiClassifyCache.get(cacheKey)
    const promise = cached ?? classifyErrorByAI(error, i18n.language)
    if (!cached) aiClassifyCache.set(cacheKey, promise)
    promise
      .then((summary) => {
        if (!cancelled && summary) setAiSummary(summary)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Intentionally exclude `error` from deps — its identity changes per render but we only
    // care about the message string for both the cache key and dispatch. The captured `error`
    // is fine because its message is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classification.category, errorMessage, i18n.language])

  const diagnosisContext = useMemo(
    () => ({
      errorSource: 'chat' as const,
      providerName: (error as Record<string, unknown> | undefined)?.providerId as string | undefined,
      modelId: (error as Record<string, unknown> | undefined)?.modelId as string | undefined
    }),
    [error]
  )

  const onRemoveErrorPart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setTimeoutTimer(
        'onRemoveErrorPart',
        async () => {
          try {
            const res = (await dataApiService.get(`/messages/${message.id}`)) as {
              data?: { parts?: CherryMessagePart[] }
            }
            const currentParts = res.data?.parts ?? []
            // Parse part index from partId (format: ${messageId}-part-${index} or ${messageId}-block-${index})
            const partMatch = partId.match(/-(?:part|block)-(\d+)$/)
            const partIndex = partMatch ? parseInt(partMatch[1], 10) : -1
            if (
              partIndex >= 0 &&
              partIndex < currentParts.length &&
              (currentParts[partIndex].type as string) === 'data-error'
            ) {
              const updatedParts = currentParts.filter((_, i) => i !== partIndex)
              await dataApiService.patch(`/messages/${message.id}`, { body: { data: { parts: updatedParts } } })
              refresh()
            }
          } catch (err) {
            logger.error('Failed to remove error part:', err as Error)
          }
        },
        350
      )
    },
    [setTimeoutTimer, message.id, partId, refresh]
  )

  const showErrorDetail = () => {
    showErrorDetailPopup({
      error,
      blockId: partId,
      cachedDiagnosis,
      diagnosisContext
    })
  }

  const onNavigate = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (classification.navTarget) {
      void navigate({ to: classification.navTarget })
    }
  }

  return (
    <div
      className="group relative my-2 cursor-pointer rounded-lg border px-3.5 py-3 text-[13px] transition-all duration-200 hover:border-[color-mix(in_srgb,var(--color-error)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-error)_7%,transparent)]"
      style={{
        borderColor: 'color-mix(in srgb, var(--color-error) 20%, transparent)',
        background: 'color-mix(in srgb, var(--color-error) 4%, transparent)'
      }}
      onClick={showErrorDetail}>
      {/* Close button */}
      <button
        type="button"
        className="absolute top-2 right-2 flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded border-none bg-transparent opacity-0 transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--color-error)_12%,transparent)] hover:text-(--color-error) group-hover:opacity-100"
        onClick={onRemoveErrorPart}
        aria-label="close"
        title={t('common.close')}>
        <X size={14} />
      </button>

      {/* Header: icon + title */}
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex shrink-0 items-center justify-center" style={{ color: 'var(--color-error)' }}>
          <AlertTriangle size={15} />
        </div>
        <div className="pr-5 font-semibold text-[13px] leading-[1.4]" style={{ color: 'var(--color-error)' }}>
          {aiSummary || t(classification.i18nKey)}
        </div>
      </div>

      {/* Description */}
      <div
        className="wrap-break-word ml-5.75 line-clamp-3 text-xs leading-normal [&_a]:text-(--color-link)"
        style={{ color: 'var(--color-text-2)' }}>
        {error?.message || <ErrorMessage error={error} />}
      </div>

      {/* Footer */}
      <div className="mt-2.5 ml-5.75 flex items-center gap-2">
        {classification.navTarget && (
          <Button
            size="sm"
            type="button"
            className="inline-flex items-center gap-1 rounded-[5px] border-[color-mix(in_srgb,var(--color-error)_25%,transparent)] text-(--color-error) text-xs hover:border-(--color-error)"
            onClick={onNavigate}>
            <SettingOutlined style={{ fontSize: 12 }} />
            {t('error.diagnosis.go_to_settings')}
          </Button>
        )}
        <div
          className="ml-auto inline-flex items-center gap-0.5 text-xs transition-colors duration-150 group-hover:text-(--color-error)"
          style={{ color: 'var(--color-text-3)' }}>
          {t('common.detail')}
          <ChevronRight size={14} />
        </div>
      </div>
    </div>
  )
}

export default React.memo(ErrorBlock)
