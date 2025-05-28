import AssistantTagsSettings from '@renderer/pages/settings/AssistantSettings/AssistantTagsSettings'
import { Assistant } from '@renderer/types'
import { Modal } from 'antd'
import { useState } from 'react'

import { TopView } from '../TopView'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  resolve: (data: any) => void
  mode?: 'add' | 'manage'
}

const PopupContainer: React.FC<Props> = ({ assistant, updateAssistant, resolve, mode }) => {
  const [open, setOpen] = useState(true)

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  TagsPopup.hide = onCancel

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      title="标签管理"
      width="600px"
      transitionName="animation-move-down"
      styles={{
        content: {
          padding: '16px',
          border: `1px solid var(--color-frame-border)`
        }
      }}
      centered
      footer={null}>
      <AssistantTagsSettings assistant={assistant} updateAssistant={updateAssistant} mode={mode} />
    </Modal>
  )
}

export default class TagsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('TagsPopup')
  }
  static show(assistant: Assistant, updateAssistant: (assistant: Assistant) => void, mode?: 'add' | 'manage') {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          assistant={assistant}
          updateAssistant={updateAssistant}
          resolve={(v) => {
            resolve(v)
            TopView.hide('TagsPopup')
          }}
          mode={mode}
        />,
        'TagsPopup'
      )
    })
  }
}
