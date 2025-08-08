import { getHttpMessageLabel } from '@renderer/i18n/label'
import { useAppDispatch } from '@renderer/store'
import { removeBlocksThunk } from '@renderer/store/thunk/messageThunk'
import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'
import { Alert as AntdAlert } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  block: ErrorMessageBlock
  message: Message
}

const ErrorBlock: React.FC<Props> = ({ block, message }) => {
  return <MessageErrorInfo block={block} message={message} />
}

const MessageErrorInfo: React.FC<{ block: ErrorMessageBlock; message: Message }> = ({ block, message }) => {
  const { t, i18n } = useTranslation()
  const dispatch = useAppDispatch()

  const HTTP_ERROR_CODES = [400, 401, 403, 404, 429, 500, 502, 503, 504]

  const onRemoveBlock = () => {
    setTimeout(() => dispatch(removeBlocksThunk(message.topicId, message.id, [block.id])), 350)
  }

  if (block.error && HTTP_ERROR_CODES.includes(block.error?.status)) {
    return (
      <Alert
        description={getHttpMessageLabel(block.error.status)}
        message={block.error?.message}
        type="error"
        closable
        onClose={onRemoveBlock}
      />
    )
  }

  if (block?.error?.message) {
    const errorKey = `error.${block.error.message}`
    const pauseErrorLanguagePlaceholder = i18n.exists(errorKey) ? t(errorKey) : block.error.message
    return <Alert description={pauseErrorLanguagePlaceholder} type="error" closable onClose={onRemoveBlock} />
  }

  return <Alert description={t('error.chat.response')} type="error" closable onClose={onRemoveBlock} />
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
