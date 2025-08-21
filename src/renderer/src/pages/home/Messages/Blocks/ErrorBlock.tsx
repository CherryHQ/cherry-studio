import { getHttpMessageLabel, getZhipuErrorLabel } from '@renderer/i18n/label'
import { useAppDispatch } from '@renderer/store'
import { removeBlocksThunk } from '@renderer/store/thunk/messageThunk'
import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'
import { Alert as AntdAlert } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// 智谱错误链接配置
const ZHIPU_ERROR_LINKS = {
  no_api_key: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv',
  insufficient_balance: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/iv',
  quota_exceeded: 'https://zhipuaishengchan.datasink.sensorsdata.cn/t/yv'
} as const

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

  // 处理智谱特定错误
  const handleZhipuError = (errorType: keyof typeof ZHIPU_ERROR_LINKS) => {
    const errorMessage = getZhipuErrorLabel(errorType)
    const link = ZHIPU_ERROR_LINKS[errorType]

    // 根据当前语言获取对应的平台名称
    const getPlatformNameByLanguage = () => {
      const currentLang = i18n.language
      if (currentLang === 'zh-CN') {
        return '智谱开放平台'
      } else if (currentLang === 'zh-TW') {
        return '智譜開放平台'
      } else {
        return 'BigModel' // 其他语言都使用BigModel
      }
    }

    const platformNameToMatch = getPlatformNameByLanguage()

    // 尝试匹配当前语言的平台名称
    if (errorMessage.includes(platformNameToMatch)) {
      const parts = errorMessage.split(platformNameToMatch)
      if (parts.length === 2) {
        return (
          <Alert
            description={
              <span>
                {parts[0]}
                <StyledLink href={link} target="_blank" rel="noopener noreferrer">
                  {platformNameToMatch}
                </StyledLink>
                {parts[1]}
              </span>
            }
            type="error"
            closable
            onClose={onRemoveBlock}
          />
        )
      }
    }

    return <Alert description={errorMessage} type="error" closable onClose={onRemoveBlock} />
  }

  if (block?.error?.message && block.error.message.startsWith('zhipu.')) {
    const errorType = block.error.message.replace('zhipu.', '') as keyof typeof ZHIPU_ERROR_LINKS
    if (errorType in ZHIPU_ERROR_LINKS) {
      return handleZhipuError(errorType)
    }
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

const StyledLink = styled.a`
  color: #1890ff;
  text-decoration: none;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`

export default React.memo(ErrorBlock)
