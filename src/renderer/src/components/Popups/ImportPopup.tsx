import { ImportService } from '@renderer/services/import'
import { Alert, Modal, Progress, Space, Spin } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

interface PopupResult {
  success?: boolean
}

interface Props {
  resolve: (data: PopupResult) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [selecting, setSelecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const { t } = useTranslation()

  const onOk = async () => {
    setSelecting(true)
    try {
      // Select JSON export file
      const file = await window.api.file.open({
        filters: [{ name: t('import.title'), extensions: ['json'] }]
      })

      setSelecting(false)

      if (!file) {
        return
      }

      setImporting(true)

      // Parse file content
      const fileContent = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)

      // Import conversations
      const result = await ImportService.importConversations(fileContent)

      if (result.success) {
        window.toast.success(
          t('import.success', {
            topics: result.topicsCount,
            messages: result.messagesCount
          })
        )
        setOpen(false)
      } else {
        window.toast.error(result.error || t('import.error.unknown'))
      }
    } catch (error) {
      window.toast.error(t('import.error.unknown'))
      setOpen(false)
    } finally {
      setSelecting(false)
      setImporting(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  ImportPopup.hide = onCancel

  return (
    <Modal
      title={t('import.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      okText={t('import.confirm.button')}
      okButtonProps={{ disabled: selecting || importing, loading: selecting }}
      cancelButtonProps={{ disabled: selecting || importing }}
      maskClosable={false}
      transitionName="animation-move-down"
      centered>
      {!selecting && !importing && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>{t('import.content')}</div>
          <Alert
            message={t('import.chatgpt.help.title')}
            description={
              <div>
                <p>{t('import.chatgpt.help.step1')}</p>
                <p>{t('import.chatgpt.help.step2')}</p>
                <p>{t('import.chatgpt.help.step3')}</p>
              </div>
            }
            type="info"
            showIcon
            style={{ marginTop: 12 }}
          />
        </Space>
      )}
      {selecting && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>{t('import.selecting')}</div>
        </div>
      )}
      {importing && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Progress percent={100} status="active" strokeColor="var(--color-primary)" showInfo={false} />
          <div style={{ marginTop: 16 }}>{t('import.importing')}</div>
        </div>
      )}
    </Modal>
  )
}

const TopViewKey = 'ImportPopup'

export default class ImportPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<PopupResult>((resolve) => {
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
