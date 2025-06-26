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
    return <Alert description={t(`error.http.${block.error.status}`)} message={block.error?.message} type="error" />
  }

  if (block?.error?.message) {
    const errorKey = `error.${block.error.message}`
    const pauseErrorLanguagePlaceholder = i18n.exists(errorKey) ? t(errorKey) : block.error.message
    return <Alert description={pauseErrorLanguagePlaceholder} type="error" />
  }

  return <Alert description={t('error.chat.response')} type="error" />
}

const Alert = styled(AntdAlert)`
  margin: 0.5rem 0 !important;
  padding: 10px;
  font-size: 12px;
`
export default React.memo(ErrorBlock)
