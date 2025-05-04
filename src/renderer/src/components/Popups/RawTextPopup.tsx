import { Modal, ModalProps } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { TextAreaProps } from 'antd/lib/input'
import { TextAreaRef } from 'antd/lib/input/TextArea'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

interface ShowParams {
  text: string
  textareaProps?: TextAreaProps
  modalProps?: ModalProps
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ text, textareaProps, modalProps, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const textareaRef = useRef<TextAreaRef>(null)

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  RawTextPopup.hide = onCancel

  useEffect(() => {
    setTimeout(() => {
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        textArea.scrollTop = 0
      }
    }, 0)
  }, [])

  const handleAfterOpenChange = (visible: boolean) => {
    if (visible) {
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        textArea.focus()
        textArea.setSelectionRange(0, 0)
      }
    }
  }

  return (
    <Modal
      title={t('chat.message.raw')}
      width="60vw"
      transitionName="animation-move-down"
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      footer={null}
      centered
      afterOpenChange={handleAfterOpenChange}
      {...modalProps}>
      <TextArea
        ref={textareaRef}
        rows={2}
        spellCheck={false}
        value={text}
        style={{ ...textareaProps?.style, minHeight: '60vh', maxHeight: '80vh' }}
        {...textareaProps}
      />
    </Modal>
  )
}

const TopViewKey = 'RawTextPopup'

export default class RawTextPopup {
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
