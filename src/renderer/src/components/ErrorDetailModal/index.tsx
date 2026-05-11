import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import CodeViewer from '@renderer/components/CodeViewer'
import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import i18n from '@renderer/i18n'
import type { DiagnosisContext, DiagnosisResult } from '@renderer/services/ErrorDiagnosisService'
import type { SerializedAiSdkError, SerializedAiSdkErrorUnion, SerializedError } from '@renderer/types/error'
import {
  isSerializedAiSdkAPICallError,
  isSerializedAiSdkDownloadError,
  isSerializedAiSdkError,
  isSerializedAiSdkErrorUnion,
  isSerializedAiSdkInvalidArgumentError,
  isSerializedAiSdkInvalidDataContentError,
  isSerializedAiSdkInvalidMessageRoleError,
  isSerializedAiSdkInvalidPromptError,
  isSerializedAiSdkInvalidToolInputError,
  isSerializedAiSdkJSONParseError,
  isSerializedAiSdkMessageConversionError,
  isSerializedAiSdkNoObjectGeneratedError,
  isSerializedAiSdkNoSpeechGeneratedError,
  isSerializedAiSdkNoSuchModelError,
  isSerializedAiSdkNoSuchProviderError,
  isSerializedAiSdkNoSuchToolError,
  isSerializedAiSdkRetryError,
  isSerializedAiSdkToolCallRepairError,
  isSerializedAiSdkTooManyEmbeddingValuesForCallError,
  isSerializedAiSdkTypeValidationError,
  isSerializedAiSdkUnsupportedFunctionalityError,
  isSerializedError
} from '@renderer/types/error'
import { formatAiSdkError, formatError, safeToString } from '@renderer/utils/error'
import { parseDataUrl } from '@shared/utils'
import { CheckCircle, Copy, Loader2, Stethoscope } from 'lucide-react'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Scrollbar from '../Scrollbar'
import AIDiagnosisSectionWithStatus from './AIDiagnosisSection'

interface ErrorDetailContentProps {
  error?: SerializedError
  diagnosisContext?: DiagnosisContext
  blockId?: string
  cachedDiagnosis?: DiagnosisResult
}

const truncateLargeData = (
  data: string,
  t: (key: string) => string
): { content: string; truncated: boolean; isLikelyBase64: boolean } => {
  const parsed = parseDataUrl(data)
  const isLikelyBase64 = parsed?.isBase64 ?? false

  if (!data || data.length <= 100_000) {
    return { content: data, truncated: false, isLikelyBase64 }
  }

  if (isLikelyBase64) {
    return {
      content: `[${t('error.base64DataTruncated')}]`,
      truncated: true,
      isLikelyBase64: true
    }
  }

  return {
    content: data.slice(0, 100_000) + `\n\n... [${t('error.truncated')}]`,
    truncated: true,
    isLikelyBase64: false
  }
}

const ErrorDetailContainer = ({ className, ...props }: React.ComponentProps<typeof Scrollbar>) => (
  <Scrollbar className={cn('max-h-[60vh] pr-[5px]', className)} {...props} />
)

const ErrorDetailList = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-4', className)} {...props} />
)

const ErrorDetailItem = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-2', className)} {...props} />
)

const ErrorDetailLabel = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('font-semibold text-[14px] text-foreground', className)} {...props} />
)

const ErrorDetailValue = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'rounded-[4px] border border-[var(--color-border)] bg-background-subtle p-2 font-[var(--code-font-family)] text-[12px] text-foreground [word-break:break-word]',
      className
    )}
    {...props}
  />
)

const StackTrace = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'rounded-[6px] border border-error-base bg-background-subtle p-3 [&_pre]:m-0 [&_pre]:whitespace-pre-wrap [&_pre]:font-[var(--code-font-family)] [&_pre]:text-[12px] [&_pre]:text-error-base [&_pre]:leading-[1.4] [&_pre]:[word-break:break-word]',
      className
    )}
    {...props}
  />
)

const TruncatedBadge = ({ className, style, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn('ml-2 rounded-[4px] px-1.5 py-0.5 font-normal text-[10px] text-[var(--color-warning)]', className)}
    style={{
      background: 'var(--color-warning-bg, rgba(250, 173, 20, 0.1))',
      ...style
    }}
    {...props}
  />
)

// --- Sub-Components ---

const BuiltinError = memo(({ error }: { error: SerializedError }) => {
  const { t } = useTranslation()
  return (
    <>
      {error.name && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.name')}:</ErrorDetailLabel>
          <ErrorDetailValue className="selectable">{error.name}</ErrorDetailValue>
        </ErrorDetailItem>
      )}
      {error.message && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.message')}:</ErrorDetailLabel>
          <ErrorDetailValue className="selectable">{error.message}</ErrorDetailValue>
        </ErrorDetailItem>
      )}
      {error.stack && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.stack')}:</ErrorDetailLabel>
          <StackTrace>
            <pre>{error.stack}</pre>
          </StackTrace>
        </ErrorDetailItem>
      )}
    </>
  )
})

const AiSdkErrorBase = memo(({ error }: { error: SerializedAiSdkError }) => {
  const { t } = useTranslation()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  const { highlightCode } = useCodeStyle()
  const [highlightedString, setHighlightedString] = useState('')
  const [isTruncated, setIsTruncated] = useState(false)
  const cause = error.cause

  useEffect(() => {
    const highlight = async () => {
      try {
        const { content: truncatedCause, truncated, isLikelyBase64 } = truncateLargeData(cause || '', tRef.current)
        setIsTruncated(truncated)

        if (isLikelyBase64) {
          setHighlightedString(truncatedCause)
          return
        }

        try {
          const parsed = JSON.parse(truncatedCause || '{}')
          const formatted = JSON.stringify(parsed, null, 2)
          const result = await highlightCode(formatted, 'json')
          setHighlightedString(result)
        } catch {
          setHighlightedString(truncatedCause || '')
        }
      } catch {
        setHighlightedString(cause || '')
      }
    }
    const timer = setTimeout(highlight, 0)

    return () => clearTimeout(timer)
  }, [highlightCode, cause])

  return (
    <>
      <BuiltinError error={error} />
      {cause && (
        <ErrorDetailItem>
          <ErrorDetailLabel>
            {t('error.cause')}:{isTruncated && <TruncatedBadge>{t('error.truncatedBadge')}</TruncatedBadge>}
          </ErrorDetailLabel>
          <ErrorDetailValue>
            <div
              className="markdown [&_pre]:bg-transparent! [&_pre_span]:whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: highlightedString }}
            />
          </ErrorDetailValue>
        </ErrorDetailItem>
      )}
    </>
  )
})

const TruncatedCodeViewer = memo(
  ({ value, label, language = 'json' }: { value: string; label: string; language?: string }) => {
    const { t } = useTranslation()
    const { content, truncated, isLikelyBase64 } = truncateLargeData(value, t)

    return (
      <ErrorDetailItem>
        <ErrorDetailLabel>
          {label}:{truncated && <TruncatedBadge>{t('error.truncatedBadge')}</TruncatedBadge>}
        </ErrorDetailLabel>
        {isLikelyBase64 ? (
          <ErrorDetailValue>{content}</ErrorDetailValue>
        ) : (
          <CodeViewer value={content} className="source-view selectable" language={language} expanded />
        )}
      </ErrorDetailItem>
    )
  }
)

const AiSdkError = memo(({ error }: { error: SerializedAiSdkErrorUnion }) => {
  const { t } = useTranslation()

  return (
    <ErrorDetailList>
      {(isSerializedAiSdkAPICallError(error) || isSerializedAiSdkDownloadError(error)) && error.url && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.requestUrl')}:</ErrorDetailLabel>
          <ErrorDetailValue className="selectable">{error.url}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkAPICallError(error) && error.responseBody && (
        <TruncatedCodeViewer value={error.responseBody} label={t('error.responseBody')} />
      )}

      {(isSerializedAiSdkAPICallError(error) || isSerializedAiSdkDownloadError(error)) && error.statusCode && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.statusCode')}:</ErrorDetailLabel>
          <ErrorDetailValue className="selectable">{error.statusCode}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkAPICallError(error) && (
        <>
          {error.responseHeaders && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.responseHeaders')}:</ErrorDetailLabel>
              <CodeViewer
                value={JSON.stringify(error.responseHeaders, null, 2)}
                className="source-view"
                language="json"
                expanded
              />
            </ErrorDetailItem>
          )}

          {error.requestBodyValues && (
            <TruncatedCodeViewer value={safeToString(error.requestBodyValues)} label={t('error.requestBodyValues')} />
          )}

          {error.data && <TruncatedCodeViewer value={safeToString(error.data)} label={t('error.data')} />}
        </>
      )}

      {isSerializedAiSdkDownloadError(error) && error.statusText && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.statusText')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.statusText}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkInvalidArgumentError(error) && error.parameter && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.parameter')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.parameter}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {(isSerializedAiSdkInvalidArgumentError(error) || isSerializedAiSdkTypeValidationError(error)) && error.value && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.value')}:</ErrorDetailLabel>
          <ErrorDetailValue>{safeToString(error.value)}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkInvalidDataContentError(error) && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.content')}:</ErrorDetailLabel>
          <ErrorDetailValue>{safeToString(error.content)}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkInvalidMessageRoleError(error) && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.role')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.role}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkInvalidPromptError(error) && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.prompt')}:</ErrorDetailLabel>
          <ErrorDetailValue>{safeToString(error.prompt)}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkInvalidToolInputError(error) && (
        <>
          {error.toolName && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.toolName')}:</ErrorDetailLabel>
              <ErrorDetailValue>{error.toolName}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
          {error.toolInput && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.toolInput')}:</ErrorDetailLabel>
              <ErrorDetailValue>{error.toolInput}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
        </>
      )}

      {(isSerializedAiSdkJSONParseError(error) || isSerializedAiSdkNoObjectGeneratedError(error)) && error.text && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.text')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.text}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkMessageConversionError(error) && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.originalMessage')}:</ErrorDetailLabel>
          <ErrorDetailValue>{safeToString(error.originalMessage)}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkNoSpeechGeneratedError(error) && error.responses && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.responses')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.responses.join(', ')}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkNoObjectGeneratedError(error) && (
        <>
          {error.response && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.response')}:</ErrorDetailLabel>
              <ErrorDetailValue>{safeToString(error.response)}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
          {error.usage && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.usage')}:</ErrorDetailLabel>
              <ErrorDetailValue>{safeToString(error.usage)}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
          {error.finishReason && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.finishReason')}:</ErrorDetailLabel>
              <ErrorDetailValue>{error.finishReason}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
        </>
      )}

      {(isSerializedAiSdkNoSuchModelError(error) ||
        isSerializedAiSdkNoSuchProviderError(error) ||
        isSerializedAiSdkTooManyEmbeddingValuesForCallError(error)) &&
        error.modelId && (
          <ErrorDetailItem>
            <ErrorDetailLabel>{t('error.modelId')}:</ErrorDetailLabel>
            <ErrorDetailValue>{error.modelId}</ErrorDetailValue>
          </ErrorDetailItem>
        )}

      {(isSerializedAiSdkNoSuchModelError(error) || isSerializedAiSdkNoSuchProviderError(error)) && error.modelType && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.modelType')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.modelType}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkNoSuchProviderError(error) && (
        <>
          <ErrorDetailItem>
            <ErrorDetailLabel>{t('error.providerId')}:</ErrorDetailLabel>
            <ErrorDetailValue>{error.providerId}</ErrorDetailValue>
          </ErrorDetailItem>

          <ErrorDetailItem>
            <ErrorDetailLabel>{t('error.availableProviders')}:</ErrorDetailLabel>
            <ErrorDetailValue>{error.availableProviders.join(', ')}</ErrorDetailValue>
          </ErrorDetailItem>
        </>
      )}

      {isSerializedAiSdkNoSuchToolError(error) && (
        <>
          <ErrorDetailItem>
            <ErrorDetailLabel>{t('error.toolName')}:</ErrorDetailLabel>
            <ErrorDetailValue>{error.toolName}</ErrorDetailValue>
          </ErrorDetailItem>
          {error.availableTools && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.availableTools')}:</ErrorDetailLabel>
              <ErrorDetailValue>{error.availableTools?.join(', ') || t('common.none')}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
        </>
      )}

      {isSerializedAiSdkRetryError(error) && (
        <>
          {error.reason && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.reason')}:</ErrorDetailLabel>
              <ErrorDetailValue>{error.reason}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
          {error.lastError && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.lastError')}:</ErrorDetailLabel>
              <ErrorDetailValue>{safeToString(error.lastError)}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
          {error.errors && error.errors.length > 0 && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.errors')}:</ErrorDetailLabel>
              <ErrorDetailValue>{error.errors.map((e) => safeToString(e)).join('\n\n')}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
        </>
      )}

      {isSerializedAiSdkTooManyEmbeddingValuesForCallError(error) && (
        <>
          {error.provider && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.provider')}:</ErrorDetailLabel>
              <ErrorDetailValue>{error.provider}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
          {error.maxEmbeddingsPerCall && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.maxEmbeddingsPerCall')}:</ErrorDetailLabel>
              <ErrorDetailValue>{error.maxEmbeddingsPerCall}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
          {error.values && (
            <ErrorDetailItem>
              <ErrorDetailLabel>{t('error.values')}:</ErrorDetailLabel>
              <ErrorDetailValue>{safeToString(error.values)}</ErrorDetailValue>
            </ErrorDetailItem>
          )}
        </>
      )}

      {isSerializedAiSdkToolCallRepairError(error) && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.originalError')}:</ErrorDetailLabel>
          <ErrorDetailValue>{safeToString(error.originalError)}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkUnsupportedFunctionalityError(error) && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.functionality')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.functionality}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      <AiSdkErrorBase error={error} />
    </ErrorDetailList>
  )
})

// --- Main Content Component ---

const ErrorDetailContent: React.FC<ErrorDetailContentProps> = ({
  error,
  diagnosisContext,
  blockId,
  cachedDiagnosis
}) => {
  const { t } = useTranslation()
  const [diagStatus, setDiagStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(cachedDiagnosis ? 'done' : 'idle')
  const diagSectionRef = useRef<{ runDiagnosis: () => void }>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isInitialRenderRef = useRef(true)

  // Scroll to bottom when diagnosis status changes, but skip initial render
  useEffect(() => {
    if (isInitialRenderRef.current) {
      isInitialRenderRef.current = false
      return
    }

    if (diagStatus !== 'idle') {
      requestAnimationFrame(() => {
        containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
      })
    }
  }, [diagStatus])

  const copyErrorDetails = useCallback(() => {
    if (!error) {
      return
    }

    let errorText: string
    if (isSerializedAiSdkError(error)) {
      errorText = formatAiSdkError(error)
    } else if (isSerializedError(error)) {
      errorText = formatError(error)
    } else {
      errorText = safeToString(error)
    }

    void navigator.clipboard.writeText(errorText)
    window.toast.success(t('message.copied'))
  }, [error, t])

  const renderErrorDetails = (error?: SerializedError) => {
    if (!error) {
      return <div>{t('error.unknown')}</div>
    }

    if (isSerializedAiSdkErrorUnion(error)) {
      return <AiSdkError error={error} />
    }

    return (
      <ErrorDetailList>
        <BuiltinError error={error} />
      </ErrorDetailList>
    )
  }

  const handleDiagnose = () => {
    if (diagStatus === 'loading') return
    setDiagStatus('loading')
    diagSectionRef.current?.runDiagnosis()
  }

  const getDiagButtonText = () => {
    switch (diagStatus) {
      case 'loading':
        return t('error.diagnosis.ai_loading') + '...'
      case 'done':
        return t('error.diagnosis.ai_done')
      default:
        return t('error.diagnosis.ai_button')
    }
  }

  return (
    <>
      <ErrorDetailContainer ref={containerRef}>
        {renderErrorDetails(error)}
        {diagStatus !== 'idle' && (
          <AIDiagnosisSectionWithStatus
            key={blockId ?? error?.message}
            ref={diagSectionRef}
            error={error}
            status={diagStatus}
            onStatusChange={setDiagStatus}
            diagnosisContext={diagnosisContext}
            blockId={blockId}
            cachedDiagnosis={cachedDiagnosis}
          />
        )}
      </ErrorDetailContainer>
      <div className="my-2 mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={copyErrorDetails}>
          <Copy size={14} />
          {t('common.copy')}
        </Button>
        <Button disabled={diagStatus === 'loading'} onClick={handleDiagnose}>
          {diagStatus === 'loading' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : diagStatus === 'done' ? (
            <CheckCircle size={14} />
          ) : (
            <Stethoscope size={14} />
          )}
          {getDiagButtonText()}
        </Button>
      </div>
    </>
  )
}

export function showErrorDetailPopup(params: ErrorDetailContentProps) {
  void GeneralPopup.show({
    title: i18n.t('error.detail'),
    content: <ErrorDetailContent {...params} />,
    footer: null,
    width: '60vw',
    style: { maxWidth: '1200px', minWidth: '600px' }
  })
}

export { ErrorDetailContent }
export type { ErrorDetailContentProps }
