import { Modal } from 'antd'
import { useState } from 'react'
import styled from 'styled-components'

import { TopView } from '../TopView'

interface Props {
  text: string
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ text, resolve }) => {
  const [open, setOpen] = useState(true)

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  TextFilePreviewPopup.hide = onCancel

  return (
    <Modal
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      title={null}
      width={700}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 16
        },
        body: {
          height: '80vh',
          maxHeight: 'inherit',
          padding: 0
        }
      }}
      centered
      closable={false}
      footer={null}>
      <Text>{text}</Text>
    </Modal>
  )
}

const Text = styled.div`
  padding: 16px;
  white-space: pre;
`

export default class TextFilePreviewPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('TextFilePreviewPopup')
  }
  static show(text: string) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          text={text}
          resolve={(v) => {
            resolve(v)
            TopView.hide('TextFilePreviewPopup')
          }}
        />,
        'TextFilePreviewPopup'
      )
    })
  }
}
