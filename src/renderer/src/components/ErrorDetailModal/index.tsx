import CodeViewer from '@renderer/components/CodeViewer'
import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import i18n from '@renderer/i18n'
import { dbService } from '@renderer/services/db/DbService'
import type { DiagnosisContext, DiagnosisResult } from '@renderer/services/ErrorDiagnosisService'
import { diagnoseError } from '@renderer/services/ErrorDiagnosisService'
import store from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
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
import { Button } from 'antd'
import { CheckCircle, Loader2 } from 'lucide-react'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ErrorDetailContentProps {
  error?: SerializedError
  diagnosisContext?: DiagnosisContext
  blockId?: string
  cachedDiagnosis?: DiagnosisResult
}

function persistDiagnosis(blockId: string, diagnosis: DiagnosisResult) {
  const block = store.getState().messageBlocks.entities[blockId]
  const updatedMetadata = { ...block?.metadata, diagnosis }
  store.dispatch(updateOneBlock({ id: blockId, changes: { metadata: updatedMetadata } }))
  void dbService.updateSingleBlock(blockId, { metadata: updatedMetadata })
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

// --- Styled Components ---

const ErrorDetailContainer = styled.div`
  max-height: 60vh;
  overflow-y: auto;
`

const ErrorDetailList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ErrorDetailItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ErrorDetailLabel = styled.div`
  font-weight: 600;
  color: var(--color-text);
  font-size: 14px;
`

const ErrorDetailValue = styled.div`
  font-family: var(--code-font-family);
  font-size: 12px;
  padding: 8px;
  background: var(--color-code-background);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  word-break: break-word;
  color: var(--color-text);
`

const StackTrace = styled.div`
  background: var(--color-background-soft);
  border: 1px solid var(--color-error);
  border-radius: 6px;
  padding: 12px;

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--code-font-family);
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-error);
  }
`

const TruncatedBadge = styled.span`
  margin-left: 8px;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: normal;
  color: var(--color-warning);
  background: var(--color-warning-bg, rgba(250, 173, 20, 0.1));
  border-radius: 4px;
`

// --- Sub-Components ---

const BuiltinError = memo(({ error }: { error: SerializedError }) => {
  const { t } = useTranslation()
  return (
    <>
      {error.name && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.name')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.name}</ErrorDetailValue>
        </ErrorDetailItem>
      )}
      {error.message && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.message')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.message}</ErrorDetailValue>
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
              className="markdown [&_pre]:!bg-transparent [&_pre_span]:whitespace-pre-wrap"
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
          <CodeViewer value={content} className="source-view" language={language} expanded />
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
          <ErrorDetailValue>{error.url}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {isSerializedAiSdkAPICallError(error) && error.responseBody && (
        <TruncatedCodeViewer value={error.responseBody} label={t('error.responseBody')} />
      )}

      {(isSerializedAiSdkAPICallError(error) || isSerializedAiSdkDownloadError(error)) && error.statusCode && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.statusCode')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.statusCode}</ErrorDetailValue>
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

  const copyErrorDetails = useCallback(() => {
    if (!error) return
    let errorText: string
    if (isSerializedAiSdkError(error)) {
      errorText = formatAiSdkError(error)
    } else if (isSerializedError(error)) {
      errorText = formatError(error)
    } else {
      errorText = safeToString(error)
    }

    void navigator.clipboard.writeText(errorText)
    window.toast.addToast({ title: t('message.copied') })
  }, [error, t])

  const renderErrorDetails = (error?: SerializedError) => {
    if (!error) return <div>{t('error.unknown')}</div>
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
    <div>
      <ErrorDetailContainer>
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
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="text"
          color="default"
          disabled={diagStatus === 'loading'}
          style={diagStatus === 'done' ? { color: 'var(--color-primary)' } : undefined}
          onClick={handleDiagnose}>
          {getDiagButtonText()}
        </Button>
        <Button variant="text" color="default" onClick={copyErrorDetails}>
          {t('common.copy')}
        </Button>
        <Button variant="text" color="default" onClick={() => GeneralPopup.hide()}>
          {t('common.close')}
        </Button>
      </div>
    </div>
  )
}

interface AIDiagnosisSectionHandle {
  runDiagnosis: () => void
}

const AIDiagnosisSectionWithStatus = memo(
  ({
    error,
    status,
    onStatusChange,
    diagnosisContext,
    blockId,
    cachedDiagnosis,
    ref
  }: {
    error?: SerializedError
    status: 'idle' | 'loading' | 'done' | 'error'
    onStatusChange: (status: 'idle' | 'loading' | 'done' | 'error') => void
    diagnosisContext?: DiagnosisContext
    blockId?: string
    cachedDiagnosis?: DiagnosisResult
    ref?: React.Ref<AIDiagnosisSectionHandle>
  }) => {
    const { t, i18n } = useTranslation()
    const [result, setResult] = useState<DiagnosisResult | null>(cachedDiagnosis ?? null)
    const [diagError, setDiagError] = useState<string>('')
    const mountedRef = useRef(true)
    const cancelledRef = useRef(false)
    const panelRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
        cancelledRef.current = true
      }
    }, [])

    // Scroll diagnosis panel into view when it first renders
    useEffect(() => {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, [])

    // Auto-start diagnosis when section mounts with loading status (first click from parent)
    useEffect(() => {
      if (status === 'loading' && !cachedDiagnosis) {
        void runDiagnosis()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
    }, [])

    const runDiagnosis = useCallback(async () => {
      if (!error) return
      cancelledRef.current = false
      onStatusChange('loading')
      setDiagError('')
      try {
        const diagnosis = await diagnoseError(error, i18n.language, diagnosisContext)
        if (cancelledRef.current || !mountedRef.current) return
        setResult(diagnosis)
        onStatusChange('done')
        if (blockId) {
          persistDiagnosis(blockId, diagnosis)
        }
      } catch (err: unknown) {
        if (cancelledRef.current || !mountedRef.current) return
        setDiagError(err instanceof Error ? err.message : 'Diagnosis failed')
        onStatusChange('error')
      }
    }, [error, i18n.language, onStatusChange, diagnosisContext, blockId])

    React.useImperativeHandle(ref, () => ({ runDiagnosis }), [runDiagnosis])

    const diagPanelStyle: React.CSSProperties = {
      border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
      background: 'color-mix(in srgb, var(--color-primary) 3%, transparent)'
    }

    const stepBgStyle: React.CSSProperties = {
      background: 'color-mix(in srgb, var(--color-primary) 4%, transparent)'
    }

    return (
      <div ref={panelRef} className="mt-4 rounded-lg p-3.5 px-4" style={diagPanelStyle}>
        {status === 'loading' && (
          <div
            className="mb-2.5 flex items-center gap-1.5 font-semibold text-sm"
            style={{ color: 'var(--color-primary)' }}>
            <Loader2 size={14} className="animation-rotate" />
            {t('error.diagnosis.ai_loading')}...
          </div>
        )}
        {status === 'error' && (
          <>
            <div
              className="mb-2.5 flex items-center gap-1.5 font-semibold text-sm"
              style={{ color: 'var(--color-error)' }}>
              {diagError}
            </div>
            <button
              type="button"
              className="cursor-pointer rounded border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              onClick={() => void runDiagnosis()}>
              {t('common.retry')}
            </button>
          </>
        )}
        {status === 'done' && result && (
          <>
            <div
              className="mb-2.5 flex items-center gap-1.5 font-semibold text-sm"
              style={{ color: 'var(--color-primary)' }}>
              <CheckCircle size={14} />
              {t('error.diagnosis.ai_result')}
            </div>
            <div className="text-[13px] leading-[1.7]" style={{ color: 'var(--color-text-2)' }}>
              {result.explanation || result.summary}
            </div>
            {result.steps.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-1.5">
                {result.steps.map((step, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]"
                    style={stepBgStyle}>
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold text-[10px] text-white"
                      style={{ background: 'var(--color-primary)' }}>
                      {i + 1}
                    </span>
                    <span>{step.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    )
  }
)

export function showErrorDetailPopup(params: ErrorDetailContentProps) {
  void GeneralPopup.show({
    title: i18n.t('error.detail'),
    content: <ErrorDetailContent {...params} />,
    footer: null,
    width: '80%',
    style: { maxWidth: '1200px', minWidth: '600px' }
  })
}

export { ErrorDetailContent }
export type { ErrorDetailContentProps }
