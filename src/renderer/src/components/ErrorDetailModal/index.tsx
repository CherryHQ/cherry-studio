import type { SerializedError } from '@renderer/types/error'
import { isSerializedAiSdkError, isSerializedError } from '@renderer/types/error'
import { formatAiSdkError, formatError, safeToString } from '@renderer/utils/error'
import { Button, Modal, Typography } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ErrorDetailModalProps {
  open: boolean
  onClose: () => void
  error?: SerializedError
}

export type { ErrorDetailModalProps }

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
          <ErrorDetailValue>
            <pre>{error.stack}</pre>
          </ErrorDetailValue>
        </ErrorDetailItem>
      )}
    </>
  )
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
      errorText = safeToString(error)
    }

    navigator.clipboard.writeText(errorText)
    window.toast.addToast({ title: t('message.copied') })
  }

  const renderErrorDetails = (error?: SerializedError) => {
    if (!error) return <div>{t('error.unknown')}</div>
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
