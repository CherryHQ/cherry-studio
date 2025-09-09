import { Modal } from 'antd'
import { useState } from 'react'
import styled from 'styled-components'

import CodeEditor from '../CodeEditor'
import { TopView } from '../TopView'

interface Props {
  text: string
  title: string
  extension?: string
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ text, title, extension, resolve }) => {
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
      title={title}
      width={700}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden'
        },
        body: {
          height: '80vh',
          maxHeight: 'inherit',
          padding: 0
        }
      }}
      centered
      closable={true}
      footer={null}>
      {extension !== undefined ? (
        <Editor
          editable={false}
          expanded={false}
          height="100%"
          style={{ height: '100%' }}
          value={text}
          language={extension}
        />
      ) : (
        <Text>{text}</Text>
      )}
    </Modal>
  )
}

const Text = styled.div`
  padding: 16px;
  white-space: pre;
  cursor: text;
`

const Editor = styled(CodeEditor)`
  .cm-line {
    cursor: text;
  }
`

export default class TextFilePreviewPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('TextFilePreviewPopup')
  }
  static show(text: string, title: string, extension?: string) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          text={text}
          title={title}
          extension={extension}
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
