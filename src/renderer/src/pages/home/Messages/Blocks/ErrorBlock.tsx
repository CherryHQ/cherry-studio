import { useTimer } from '@renderer/hooks/useTimer'
import { getHttpMessageLabel, getProviderLabel } from '@renderer/i18n/label'
import { getProviderById } from '@renderer/services/ProviderService'
import { useAppDispatch } from '@renderer/store'
import { removeBlocksThunk } from '@renderer/store/thunk/messageThunk'
import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'
import { Alert as AntdAlert } from 'antd'
import React from 'react'
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

  const i18nKey = `error.${block.error?.i18nKey}`
  const errorKey = `error.${block.error?.message}`
  const errorStatus = block.error?.status

  if (i18n.exists(i18nKey)) {
    const providerId = block.error?.providerId
    if (providerId) {
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

  if (HTTP_ERROR_CODES.includes(errorStatus)) {
    return (
      <h5>
        {getHttpMessageLabel(errorStatus)} {block.error?.message}
      </h5>
    )
  }

  return block.error?.message || ''
}

const ErrorDescription: React.FC<{ block: ErrorMessageBlock }> = ({ block }) => {
  const { t } = useTranslation()

  if (block.error) {
    return <ErrorMessage block={block} />
  }

  return <>{t('error.chat.response')}</>
}

const MessageErrorInfo: React.FC<{ block: ErrorMessageBlock; message: Message }> = ({ block, message }) => {
  const dispatch = useAppDispatch()
  const { setTimeoutTimer } = useTimer()

  const onRemoveBlock = () => {
    setTimeoutTimer('onRemoveBlock', () => dispatch(removeBlocksThunk(message.topicId, message.id, [block.id])), 350)
  }

  return <Alert description={<ErrorDescription block={block} />} type="error" closable onClose={onRemoveBlock} />
}

const Alert = styled(AntdAlert)`
  margin: 0.5rem 0 !important;
  padding: 10px;
  font-size: 12px;
  & .ant-alert-close-icon {
    margin: 5px;
  }
`

export default React.memo(ErrorBlock)
