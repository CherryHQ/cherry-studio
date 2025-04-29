import { TranslationOutlined } from '@ant-design/icons'
import { Message } from '@renderer/types'
import { Divider } from 'antd'
import { FC, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

import Markdown from '../Markdown/Markdown'

interface Props {
  message: Message
}

const MessageTranslate: FC<Props> = ({ message }) => {
  const { t } = useTranslation()

  if (!message.translatedContent) {
    return null
  }

  return (
    <Fragment>
      <Divider style={{ margin: 0, marginBottom: 10 }}>
        <TranslationOutlined />
      </Divider>
      {message.translatedContent === t('translate.processing') ? (
        <BeatLoader color="var(--color-text-2)" size="10" style={{ marginBottom: 15 }} />
      ) : (
        <Markdown message={{ ...message, content: message.translatedContent }} />
      )}
    </Fragment>
  )
}

export default MessageTranslate
