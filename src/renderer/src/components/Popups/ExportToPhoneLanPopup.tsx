import { exportToPhone } from '@renderer/services/BackupService'
import { Button, Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  useEffect(() => {
    window.api.webSocket.start()
  }, [])

  const onOk = async () => {
    await exportToPhone()
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const onConnect = async () => {
    const { isRunning, port } = await window.api.webSocket.status()
    console.log('Status: ', isRunning, port)
  }

  const onDisconnect = () => {
    window.api.webSocket.stop()
  }
  ExportToPhoneLanPopup.hide = onCancel

  return (
    <Modal
      title={t('exportToPhone.lan.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      okText={t('exportToPhone.confirm.button')}
      maskClosable={false}
      transitionName="animation-move-down"
      centered>
      <div>{t('exportToPhone.lan.content')}</div>
      <Button onClick={onConnect}>connect</Button>
      <Button onClick={onDisconnect}>disconnect</Button>
    </Modal>
  )
}

const TopViewKey = 'ExportToPhoneLanPopup'

export default class ExportToPhoneLanPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
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
