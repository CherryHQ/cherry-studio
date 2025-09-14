import { TopView } from '@renderer/components/TopView'
import { Modal, ModalProps } from 'antd'
import { ReactNode, useState } from 'react'

interface ShowParams extends ModalProps {
  content: ReactNode
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ content, resolve, ...rest }) => {
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

  GeneralPopup.hide = onCancel

  return (
    <Modal
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered
      {...rest}>
      {content}
    </Modal>
  )
}

const TopViewKey = 'GeneralPopup'

/** 在这个 Popup 中展示任意内容 */
export default class GeneralPopup {
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
