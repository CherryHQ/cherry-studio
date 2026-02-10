import type { Assistant } from '@renderer/types'
import { Drawer, Tooltip } from 'antd'
import { t } from 'i18next'
import { ListOrdered } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'

import NavbarIcon from '../../../../../components/NavbarIcon'
import QuestionIndexContent from './QuestionIndexContent'

interface Props {
  assistant?: Assistant
}

const QuestionsButton: FC<Props> = () => {
  const [indexOpen, setIndexOpen] = useState(false)

  return (
    <>
      <Tooltip title={t('chat.questions.title')} mouseEnterDelay={0.8}>
        <NavbarIcon onClick={() => setIndexOpen(true)}>
          <ListOrdered size={18} />
        </NavbarIcon>
      </Tooltip>
      <Drawer
        title={t('chat.questions.questionIndex')}
        placement="right"
        open={indexOpen}
        onClose={() => setIndexOpen(false)}
        width="var(--assistants-width)"
        closable={false}
        styles={{ body: { padding: 0, paddingTop: 'var(--navbar-height)' } }}>
        <QuestionIndexContent
          onItemClick={() => setIndexOpen(false)} // 点击某个问题后自动关闭抽屉
        />
      </Drawer>
    </>
  )
}

export default QuestionsButton
