import { Modal, ModalProps } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { TextAreaProps } from 'antd/lib/input'
import { TextAreaRef } from 'antd/lib/input/TextArea'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { TopView } from '../TopView'

interface ShowParams {
  text: string
  textareaProps?: TextAreaProps
  modalProps?: ModalProps
  children?: (props: { onOk?: () => void; onCancel?: () => void }) => React.ReactNode
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ text, textareaProps, modalProps, resolve, children }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [textValue, setTextValue] = useState(text)
  const textareaRef = useRef<TextAreaRef>(null)

  const onOk = () => {
    setOpen(false)
    resolve(textValue)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  const resizeTextArea = () => {
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    const maxHeight = innerHeight * 0.6
    if (textArea) {
      textArea.style.height = 'auto'
      textArea.style.height = textArea?.scrollHeight > maxHeight ? maxHeight + 'px' : `${textArea?.scrollHeight}px`
    }
  }

  useEffect(() => {
    setTimeout(resizeTextArea, 0)
  }, [])

  const handleAfterOpenChange = (visible: boolean) => {
    if (visible) {
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        textArea.focus()
        const length = textArea.value.length
        textArea.setSelectionRange(length, length)
      }
    }
  }

  TextEditPopup.hide = onCancel

  return (
    <Modal
      title={t('common.edit')}
      width="60vw"
      style={{ maxHeight: '70vh' }}
      transitionName="ant-move-down"
      okText={t('common.save')}
      {...modalProps}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      afterOpenChange={handleAfterOpenChange}
      centered>
      <TextArea
        ref={textareaRef}
        rows={2}
        autoFocus
        spellCheck={false}
        {...textareaProps}
        value={textValue}
        onInput={resizeTextArea}
        onChange={(e) => setTextValue(e.target.value)}
      />
      <ChildrenContainer>{children && children({ onOk, onCancel })}</ChildrenContainer>
    </Modal>
  )
}

const TopViewKey = 'TextEditPopup'

const ChildrenContainer = styled.div`
  position: relative;
`

export default class TextEditPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
