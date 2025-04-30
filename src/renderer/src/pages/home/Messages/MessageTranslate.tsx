import { TranslationOutlined } from '@ant-design/icons'
import type { TranslationMessageBlock } from '@renderer/types/newMessage'
import { Divider } from 'antd'
import { FC, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

import Markdown from '../Markdown/Markdown'

interface Props {
  block: TranslationMessageBlock
}

const MessageTranslate: FC<Props> = ({ block }) => {
  const { t } = useTranslation()

  if (!block.content) {
    return null
  }

  return (
    <Fragment>
      <Divider style={{ margin: 0, marginBottom: 10 }}>
        <TranslationOutlined />
      </Divider>
      {block.content === t('translate.processing') ? (
        <BeatLoader color="var(--color-text-2)" size="10" style={{ marginBottom: 15 }} />
      ) : (
        <Markdown block={block} />
      )}
    </Fragment>
  )
}

export default MessageTranslate
