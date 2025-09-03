import CodeViewer from '@renderer/components/CodeViewer'
import { useTimer } from '@renderer/hooks/useTimer'
import { getHttpMessageLabel, getProviderLabel } from '@renderer/i18n/label'
import { getProviderById } from '@renderer/services/ProviderService'
import { useAppDispatch } from '@renderer/store'
import { removeBlocksThunk } from '@renderer/store/thunk/messageThunk'
import {
  isSerializedAiSdkAPICallError,
  isSerializedAiSdkError,
  isSerializedError,
  SerializedAiSdkAPICallError,
  SerializedAiSdkError,
  SerializedError
} from '@renderer/types/error'
import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'
import { formatAiSdkError, formatError, safeToString } from '@renderer/utils/error'
import { Alert as AntdAlert, Button, Modal } from 'antd'
import React, { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

const HTTP_ERROR_CODES = [400, 401, 403, 404, 429, 500, 502, 503, 504]

interface Props {
  block: ErrorMessageBlock
  message: Message
}

const ErrorBlock: React.FC<Props> = ({ block, message }) => {
  return <MessageErrorInfo block={block} message={message} />
}

const ErrorMessage: React.FC<{ block: ErrorMessageBlock }> = ({ block }) => {
  const { t, i18n } = useTranslation()

  const i18nKey = block.error && 'i18nKey' in block.error ? `error.${block.error?.i18nKey}` : ''
  const errorKey = `error.${block.error?.message}`
  const errorStatus =
    block.error && ('status' in block.error || 'statusCode' in block.error)
      ? block.error?.status || block.error?.statusCode
      : undefined

  if (i18n.exists(i18nKey)) {
    const providerId = block.error && 'providerId' in block.error ? block.error?.providerId : undefined
    if (providerId && typeof providerId === 'string') {
      return (
        <Trans
          i18nKey={i18nKey}
          values={{ provider: getProviderLabel(providerId) }}
          components={{
            provider: (
              <Link
                style={{ color: 'var(--color-link)' }}
                to={`/settings/provider`}
                state={{ provider: getProviderById(providerId) }}
              />
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
      <h5>
        {getHttpMessageLabel(errorStatus.toString())} {block.error?.message}
      </h5>
    )
  }

  return block.error?.message || ''
}

const MessageErrorInfo: React.FC<{ block: ErrorMessageBlock; message: Message }> = ({ block, message }) => {
  const dispatch = useAppDispatch()
  const { setTimeoutTimer } = useTimer()
  const [showDetailModal, setShowDetailModal] = useState(false)
  const { t } = useTranslation()

  const onRemoveBlock = () => {
    setTimeoutTimer('onRemoveBlock', () => dispatch(removeBlocksThunk(message.topicId, message.id, [block.id])), 350)
  }

  const showErrorDetail = () => {
    setShowDetailModal(true)
  }

  const getAlertMessage = () => {
    const status =
      block.error && ('status' in block.error || 'statusCode' in block.error)
        ? block.error?.status || block.error?.statusCode
        : undefined
    if (block.error && typeof status === 'number' && HTTP_ERROR_CODES.includes(status)) {
      return block.error.message
    }
    return null
  }

  const getAlertDescription = () => {
    const status =
      block.error && ('status' in block.error || 'statusCode' in block.error)
        ? block.error?.status || block.error?.statusCode
        : undefined
    if (block.error && typeof status === 'number' && HTTP_ERROR_CODES.includes(status)) {
      return getHttpMessageLabel(status.toString())
    }
    return <ErrorMessage block={block} />
  }

  return (
    <>
      <Alert
        message={getAlertMessage()}
        description={getAlertDescription()}
        type="error"
        closable
        onClose={onRemoveBlock}
        onClick={showErrorDetail}
        style={{ cursor: 'pointer' }}
        action={
          <Button
            size="small"
            type="text"
            onClick={(e) => {
              e.stopPropagation()
              showErrorDetail()
            }}>
            {t('common.detail')}
          </Button>
        }
      />
      <ErrorDetailModal open={showDetailModal} onClose={() => setShowDetailModal(false)} error={block.error} />
    </>
  )
}

interface ErrorDetailModalProps {
  open: boolean
  onClose: () => void
  error?: SerializedError
}

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
      // fallback
      errorText = safeToString(error)
    }

    navigator.clipboard.writeText(errorText)
    window.message.success(t('message.copied'))
  }

  const renderErrorDetails = (error?: SerializedError) => {
    if (!error) return <div>{t('error.unknown')}</div>
    if (isSerializedAiSdkAPICallError(error)) {
      return <AiApiCallError error={error} />
    }
    if (isSerializedAiSdkError(error)) {
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
        <Button key="copy" onClick={copyErrorDetails}>
          {t('common.copy')}
        </Button>,
        <Button key="close" onClick={onClose}>
          {t('common.close')}
        </Button>
      ]}
      width={600}>
      <ErrorDetailContainer>{renderErrorDetails(error)}</ErrorDetailContainer>
    </Modal>
  )
}

const ErrorDetailContainer = styled.div`
  max-height: 400px;
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

const Alert = styled(AntdAlert)`
  margin: 0.5rem 0 !important;
  padding: 10px;
  font-size: 12px;
  & .ant-alert-close-icon {
    margin: 5px;
  }
`

// 作为 base，渲染公共字段，应当在 ErrorDetailList 中渲染
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

// 作为 base，渲染公共字段，应当在 ErrorDetailList 中渲染
const AiSdkError = ({ error }: { error: SerializedAiSdkError }) => {
  const { t } = useTranslation()
  const cause = error.cause
  return (
    <>
      <BuiltinError error={error} />
      {cause && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.cause')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.cause}</ErrorDetailValue>
        </ErrorDetailItem>
      )}
    </>
  )
}

const AiApiCallError = ({ error }: { error: SerializedAiSdkAPICallError }) => {
  const { t } = useTranslation()

  // 这些字段是 unknown 类型，暂且不清楚都可能是什么类型，总之先覆盖下大部分场景
  const requestBodyValues = safeToString(error.requestBodyValues)
  const data = safeToString(error.data)

  return (
    <ErrorDetailList>
      <AiSdkError error={error} />

      {error.url && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.requestUrl')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.url}</ErrorDetailValue>
        </ErrorDetailItem>
      )}

      {requestBodyValues && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.requestBodyValues')}:</ErrorDetailLabel>
          <CodeViewer value={safeToString(error.requestBodyValues)} className="source-view" language="json" expanded />
        </ErrorDetailItem>
      )}

      {error.statusCode && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.statusCode')}:</ErrorDetailLabel>
          <ErrorDetailValue>{error.statusCode}</ErrorDetailValue>
        </ErrorDetailItem>
      )}
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

      {error.responseBody && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.responseBody')}:</ErrorDetailLabel>
          <CodeViewer value={error.responseBody} className="source-view" language="json" expanded />
        </ErrorDetailItem>
      )}

      {data && (
        <ErrorDetailItem>
          <ErrorDetailLabel>{t('error.data')}:</ErrorDetailLabel>
          <CodeViewer value={safeToString(error.data)} className="source-view" language="json" expanded />
        </ErrorDetailItem>
      )}
    </ErrorDetailList>
  )
}

export default React.memo(ErrorBlock)
