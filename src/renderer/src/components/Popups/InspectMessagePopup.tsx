import { usePreference } from '@data/hooks/usePreference'
import { TopView } from '@renderer/components/TopView'
import type { Message } from '@renderer/types'
import type { MessageBlock } from '@renderer/types/newMessage'
import { Modal } from 'antd'
import { useState } from 'react'

import CodeEditor from '../CodeEditor'

interface ShowParams {
  title: string
  message: Message
  blocks: MessageBlock[]
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const InspectMessagePopupContainer: React.FC<Props> = ({ title, message, blocks, resolve }) => {
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
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

  InspectMessagePopup.hide = onCancel

  if (!enableDeveloperMode) {
    return null
  }

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      width={'80vw'}
      transitionName="animation-move-down"
      centered>
      <div className="mb-2 font-bold text-xl">Message</div>
      <CodeEditor language="json" value={JSON.stringify(message, null, 2)} editable={false} />
      <div className="mb-2 font-bold text-xl">Blocks ({blocks.length})</div>
      <CodeEditor language="json" value={JSON.stringify(blocks, null, 2)} editable={false} />
    </Modal>
  )
}

const TopViewKey = 'InspectMessagePopup'

export default class InspectMessagePopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <InspectMessagePopupContainer
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
