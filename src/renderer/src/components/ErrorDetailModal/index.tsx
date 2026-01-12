import CodeViewer from '@renderer/components/CodeViewer'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import type { SerializedAiSdkError, SerializedAiSdkErrorUnion, SerializedError } from '@renderer/types/error'
import {
  isSerializedAiSdkAPICallError,
  isSerializedAiSdkDownloadError,
  isSerializedAiSdkError,
  isSerializedAiSdkErrorUnion,
  isSerializedAiSdkInvalidArgumentError,
  isSerializedAiSdkInvalidDataContentError,
  isSerializedAiSdkInvalidMessageRoleError,
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
import { Button, Modal, Typography } from 'antd'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface ErrorDetailModalProps {
  open: boolean
  onClose: () => void
  error?: SerializedError
}

// --- Styled Components ---

const ErrorDetailContainer = styled.div`
  max-height: 60vh;
  overflow-y: auto;
  padding: 16px 0;
`

const ErrorDetailList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ErrorDetailItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  line-height: 1.5;
  word-break: break-word;
`

const ErrorDetailLabel = styled(Typography.Text)`
  color: var(--color-text-secondary);
  min-width: 120px;
  flex-shrink: 0;
`

const ErrorDetailValue = styled(Typography.Text)`
  flex: 1;
  color: var(--color-text);
  white-space: pre-wrap;
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

// --- Helper Functions ---

const truncateLargeData = (
  value: string
): {
  content: string
  truncated: boolean
  isLikelyBase64: boolean
} => {
  const KB_SIZE = 1024
  const MAX_SIZE = 100 * KB_SIZE
  const TRUNCATE_SIZE = 50 * KB_SIZE

  // Check for base64 pattern
  const base64Pattern = /^[A-Za-z0-9+/=]+$/
  const isLikelyBase64 = base64Pattern.test(value) && value.length > 100

  if (value.length <= MAX_SIZE && !isLikelyBase64) {
    return { content: value, truncated: false, isLikelyBase64 }
  }

  return {
    content: value.slice(0, TRUNCATE_SIZE) + '...',
    truncated: true,
    isLikelyBase64
  }
}

// --- Sub-Components ---

const BuiltinError = ({ error }: { error: SerializedError }) => {
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
}

const AiSdkErrorBase = ({ error }: { error: SerializedAiSdkError }) => {
  const { t } = useTranslation()
  const { highlightCode } = useCodeStyle()
  const [highlightedString, setHighlightedString] = useState('')
  const [isTruncated, setIsTruncated] = useState(false)
  const cause = error.cause

  useEffect(() => {
    const highlight = async () => {
      try {
        const { content: truncatedCause, truncated, isLikelyBase64 } = truncateLargeData(cause || '')
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
  }, [highlightCode, cause, t])

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
}

const TruncatedCodeViewer: React.FC<{ value: string; label: string; language?: string }> = ({
  value,
  label,
  language = 'json'
}) => {
  const { t } = useTranslation()
  const { content, truncated, isLikelyBase64 } = truncateLargeData(value)

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

const AiSdkError = ({ error }: { error: SerializedAiSdkErrorUnion }) => {
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

      {isSerializedAiSdkAPICallError(error) && error.responseHeaders && (
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

      {isSerializedAiSdkAPICallError(error) && error.requestBodyValues && (
        <TruncatedCodeViewer value={safeToString(error.requestBodyValues)} label={t('error.requestBodyValues')} />
      )}

      {isSerializedAiSdkAPICallError(error) && error.data && (
        <TruncatedCodeViewer value={safeToString(error.data)} label={t('error.data')} />
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

      {(isSerializedAiSdkNoSuchModelError(error) || isSerializedAiSdkNoSuchProviderError(error)) && error.modelId && (
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

      {isSerializedAiSdkNoSuchProviderError(error) && error.availableProviders && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.availableProviders')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.availableProviders.join(', ')}</ErrorDetailValue>
        </ErrorDetailItem>
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
}

// --- Main Component ---

const ErrorDetailModal: React.FC<ErrorDetailModalProps> = ({ open, onClose, error }) => {
  const { t } = useTranslation()

  const copyErrorDetails = () => {
    if (!error) return
    let errorText: string
    if (isSerializedAiSdkError(error)) {
      errorText = formatAiSdkError(error)
    } else if (isSerializedError(error)) {
      errorText = formatError(error)
    } else {
      errorText = safeToString(error)
    }
    navigator.clipboard.writeText(errorText)
    window.toast.addToast({ title: t('message.copied') })
  }

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

  return (
    <Modal
      centered
      title={t('error.detail')}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="copy" variant="text" color="default" onClick={copyErrorDetails}>
          {t('common.copy')}
        </Button>,
        <Button key="close" variant="text" color="default" onClick={onClose}>
          {t('common.close')}
        </Button>
      ]}
      width="80%"
      style={{ maxWidth: '1200px', minWidth: '600px' }}>
      <ErrorDetailContainer>{renderErrorDetails(error)}</ErrorDetailContainer>
    </Modal>
  )
}

export { ErrorDetailModal as default, ErrorDetailModal }
export type { ErrorDetailModalProps as ErrorDetailModalPropsType }
