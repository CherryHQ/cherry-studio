import type { ErrorMessageBlock } from '@renderer/types/newMessage'
import { Alert as AntdAlert } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  block: ErrorMessageBlock
}

const ErrorBlock: React.FC<Props> = ({ block }) => {
  return <MessageErrorInfo block={block} />
}

const MessageErrorInfo: React.FC<{ block: ErrorMessageBlock }> = ({ block }) => {
  const { t, i18n } = useTranslation()

  const HTTP_ERROR_CODES = [400, 401, 403, 404, 429, 500, 502, 503, 504]

  if (block.error && HTTP_ERROR_CODES.includes(block.error?.status)) {
    return (
      <StyledAlert
        message={t('error.http.title')}
        description={
          <ErrorContent>
            <div>{t(`error.http.${block.error.status}`)}</div>
            {block.error?.message && <div className="error-message">{block.error.message}</div>}
          </ErrorContent>
        }
        type="error"
      />
    )
  }

  if (block?.error?.message) {
    const errorKey = `error.${block.error.message}`
    const pauseErrorLanguagePlaceholder = i18n.exists(errorKey) ? t(errorKey) : block.error.message
    return (
      <StyledAlert
        description={
          <ErrorContent>
            <div>{pauseErrorLanguagePlaceholder}</div>
            {block.error?.originalMessage && <div className="error-details">{block.error.originalMessage}</div>}
          </ErrorContent>
        }
        type="error"
      />
    )
  }

  return <StyledAlert description={t('error.chat.response')} type="error" />
}

const StyledAlert = styled(AntdAlert)`
  margin: 15px 0 8px;
  padding: 12px 16px;
  font-size: 13px;
  border-radius: 6px;

  .ant-alert-message {
    color: #cf1322;
    margin-bottom: 4px;
  }

  .ant-alert-description {
    color: rgba(0, 0, 0, 0.75);
  }
`

const ErrorContent = styled.div`
  .error-message {
    margin-top: 4px;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.45);
  }

  .error-details {
    margin-top: 8px;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.45);
    padding: 8px;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 4px;
  }
`

export default React.memo(ErrorBlock)
