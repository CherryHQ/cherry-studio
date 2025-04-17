import { TranslationOutlined } from '@ant-design/icons'
import type { MainTextMessageBlock, TranslationMessageBlock } from '@renderer/types/newMessageTypes'
import { Divider } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

import Markdown from '../../Markdown/Markdown'

interface Props {
  block: TranslationMessageBlock
}

const TranslationBlock: React.FC<Props> = ({ block }) => {
  const { t } = useTranslation()
  return (
    <>
      <Divider style={{ margin: 0, marginBottom: 10 }}>
        <TranslationOutlined />
      </Divider>
      {block.content === t('translate.processing') ? (
        <BeatLoader color="var(--color-text-2)" size="10" style={{ marginBottom: 15 }} />
      ) : (
        <Markdown message={{ ...block, content: block.content } as MainTextMessageBlock} />
      )}
    </>
  )
}

export default React.memo(TranslationBlock)
