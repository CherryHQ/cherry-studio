import { ErrorDetailModal } from '@renderer/components/ErrorDetailModal'
import { useTimer } from '@renderer/hooks/useTimer'
import { getHttpMessageLabel, getProviderLabel } from '@renderer/i18n/label'
import { getProviderById } from '@renderer/services/ProviderService'
import { useAppDispatch } from '@renderer/store'
import { removeBlocksThunk } from '@renderer/store/thunk/messageThunk'
import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'
import { Button } from 'antd'
import { Alert as AntdAlert } from 'antd'
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

  const onRemoveBlock = (e: React.MouseEvent) => {
    e.stopPropagation()
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
          <>
            <Button size="middle" color="default" variant="text" onClick={showErrorDetail}>
              {t('common.detail')}
            </Button>
          </>
        }
      />
      <ErrorDetailModal open={showDetailModal} onClose={() => setShowDetailModal(false)} error={block.error} />
    </>
  )
}

const Alert = styled(AntdAlert)`
  margin: 0.5rem 0 !important;
  padding: 10px;
  font-size: 12px;
  align-items: center;
  & .ant-alert-close-icon {
    margin: 5px;
  }
`

export default React.memo(ErrorBlock)
