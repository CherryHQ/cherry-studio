import type { ErrorMessageBlock } from '@renderer/types/newMessage'
import { Alert as AntdAlert } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const MessageError: FC<{ block: ErrorMessageBlock }> = ({ block }) => {
  return (
    <>
      {/* <Markdown block={block} role={role} />
      {block.error && (
        <Markdown
          message={{
            ...block,
            content: formatErrorMessage(block.error)
          }}
        />
      )} */}
      <MessageErrorInfo block={block} />
    </>
  )
}

const MessageErrorInfo: FC<{ block: ErrorMessageBlock }> = ({ block }) => {
  const { t } = useTranslation()

  const HTTP_ERROR_CODES = [400, 401, 403, 404, 429, 500, 502, 503, 504]
  console.log('block', block)
  if (block.error && HTTP_ERROR_CODES.includes(block.error?.status)) {
    return <Alert description={t(`error.http.${block.error.status}`)} type="error" />
  }
  if (block?.error?.message) {
    return <Alert description={block.error.message} type="error" />
  }

  return <Alert description={t('error.chat.response')} type="error" />
}

const Alert = styled(AntdAlert)`
  margin: 15px 0 8px;
  padding: 10px;
  font-size: 12px;
`

export default MessageError
