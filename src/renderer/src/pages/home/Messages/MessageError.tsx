import { Message } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import { Alert as AntdAlert } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Markdown from '../Markdown/Markdown'
const MessageError: FC<{ message: Message }> = ({ message }) => {
  const { t } = useTranslation()

  // 首先检查是否存在已知的问题错误
  if (message.error && typeof message.error === 'object') {
    // 处理 rememberInstructions 错误
    if (message.error.message === 'rememberInstructions is not defined') {
      return (
        <>
          <Markdown message={message} />
          <Alert description="消息加载时发生错误" type="error" />
        </>
      )
    }

    // 处理网络错误
    if (message.error.message === 'network error') {
      return (
        <>
          <Markdown message={message} />
          <Alert description={t('error.network')} type="error" />
        </>
      )
    }
  }

  return (
    <>
      <Markdown message={message} />
      {message.error && (
        <Markdown
          message={{
            ...message,
            content: formatErrorMessage(message.error)
          }}
        />
      )}
      <MessageErrorInfo message={message} />
    </>
  )
}

const MessageErrorInfo: FC<{ message: Message }> = ({ message }) => {
  const { t } = useTranslation()

  const HTTP_ERROR_CODES = [400, 401, 403, 404, 429, 500, 502, 503, 504]

  // Add more robust checks: ensure error is an object and status is a number before accessing/including
  if (
    message.error &&
    typeof message.error === 'object' && // Check if error is an object
    typeof message.error.status === 'number' && // Check if status is a number
    HTTP_ERROR_CODES.includes(message.error.status) // Now safe to access status
  ) {
    return <Alert description={t(`error.http.${message.error.status}`)} type="error" />
  }

  return <Alert description={t('error.chat.response')} type="error" />
}

const Alert = styled(AntdAlert)`
  margin: 15px 0 8px;
  padding: 10px;
  font-size: 12px;
`

export default MessageError
