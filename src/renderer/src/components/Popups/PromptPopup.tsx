import { Input, Modal } from 'antd'
import { TextAreaProps } from 'antd/es/input'
import { useRef, useState } from 'react'

import { Box } from '../Layout'
import { TopView } from '../TopView'

interface PromptPopupShowParams {
  title: string
  message: string
  defaultValue?: string
  inputPlaceholder?: string
  inputProps?: TextAreaProps
}

interface Props extends PromptPopupShowParams {
  resolve: (value: any) => void
}

const PromptPopupContainer: React.FC<Props> = ({
  title,
  message,
  defaultValue = '',
  inputPlaceholder = '',
  inputProps = {},
  resolve
}) => {
  const [value, setValue] = useState(defaultValue)
  const [open, setOpen] = useState(true)
  const textAreaRef = useRef<any>(null)

  const onOk = () => {
    setOpen(false)
    resolve(value)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onAfterClose = () => {
    resolve(null)
    TopView.hide(TopViewKey)
  }

  const handleAfterOpenChange = (visible: boolean) => {
    if (visible) {
      const textArea = textAreaRef.current?.resizableTextArea?.textArea
      if (textArea) {
        textArea.focus()
        const length = textArea.value.length
        textArea.setSelectionRange(length, length)
      }
    }
  }

  PromptPopup.hide = onCancel

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onAfterClose}
      afterOpenChange={handleAfterOpenChange}
      transitionName="animation-move-down"
      centered>
      <Box mb={8}>{message}</Box>
      <Input.TextArea
        ref={textAreaRef}
        placeholder={inputPlaceholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        styles={{
          textarea: {
            maxHeight: '80vh'
          }
        }}
        allowClear
        onKeyDown={(e) => {
          const isEnterPressed = e.keyCode === 13
          if (isEnterPressed && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault()
            onOk()
          }
        }}
        rows={1}
        {...inputProps}
      />
    </Modal>
  )
}

const TopViewKey = 'PromptPopup'

export default class PromptPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: PromptPopupShowParams) {
    return new Promise<string>((resolve) => {
      TopView.show(<PromptPopupContainer {...props} resolve={resolve} />, 'PromptPopup')
    })
  }
}
