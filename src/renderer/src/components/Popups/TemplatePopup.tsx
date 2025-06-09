import { Box } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { Modal } from 'antd'
import { useState } from 'react'

interface ShowParams {
  title: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)

  const onOk = () => {
    resolve(true)
    setOpen(false)
  }

  const onCancel = () => {
    resolve(false)
    setOpen(false)
  }

  const onClose = () => {
    TopView.hide(TopViewKey)
  }

  TemplatePopup.hide = onCancel

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered>
      <Box mb={8}>Name</Box>
    </Modal>
  )
}

const TopViewKey = 'TemplatePopup'

export default class TemplatePopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(<PopupContainer {...props} resolve={resolve} />, TopViewKey)
    })
  }
}
