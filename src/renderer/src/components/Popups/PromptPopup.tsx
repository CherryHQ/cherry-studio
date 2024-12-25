import { Input, Modal } from 'antd'
import { TextAreaProps } from 'antd/es/input'
import { useState } from 'react'

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

  const onOk = () => {
    setOpen(false)
    resolve(value)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  PromptPopup.hide = onCancel

  return (
    <Modal title={title} open={open} onOk={onOk} onCancel={onCancel} afterClose={onClose} centered>
      <Box mb={8}>{message}</Box>
      <Input.TextArea
        placeholder={inputPlaceholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        allowClear
        autoFocus
        onPressEnter={onOk}
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
      TopView.show(
        <PromptPopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        'PromptPopup'
      )
    })
  }
}
