import { ImportService } from '@renderer/services/import'
import { Alert, Modal, Progress, Space, Spin } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

interface PopupResult {
  success?: boolean
}

interface Props {
  importer: 'chatgpt' | 'chatbox'
  resolve: (data: PopupResult) => void
}

type Importer = Props['importer']

const IMPORT_I18N_KEYS: Record<
  Importer,
  {
    title: string
    button: string
    description: string
    selecting: string
    importing: string
    success: string
    successWithSkipped: string
    errorUnknown: string
    help: {
      title: string
      step1: string
      step2: string
      step3: string
    }
  }
> = {
  chatgpt: {
    title: 'import.chatgpt.title',
    button: 'import.chatgpt.button',
    description: 'import.chatgpt.description',
    selecting: 'import.chatgpt.selecting',
    importing: 'import.chatgpt.importing',
    success: 'import.chatgpt.success',
    successWithSkipped: 'import.chatgpt.success',
    errorUnknown: 'import.chatgpt.error.unknown',
    help: {
      title: 'import.chatgpt.help.title',
      step1: 'import.chatgpt.help.step1',
      step2: 'import.chatgpt.help.step2',
      step3: 'import.chatgpt.help.step3'
    }
  },
  chatbox: {
    title: 'import.chatbox.title',
    button: 'import.chatbox.button',
    description: 'import.chatbox.description',
    selecting: 'import.chatbox.selecting',
    importing: 'import.chatbox.importing',
    success: 'import.chatbox.success',
    successWithSkipped: 'import.chatbox.success_with_skipped',
    errorUnknown: 'import.chatbox.error.unknown',
    help: {
      title: 'import.chatbox.help.title',
      step1: 'import.chatbox.help.step1',
      step2: 'import.chatbox.help.step2',
      step3: 'import.chatbox.help.step3'
    }
  }
}

const PopupContainer: React.FC<Props> = ({ importer, resolve }) => {
  const [open, setOpen] = useState(true)
  const [selecting, setSelecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const { t } = useTranslation()
  const i18nKeys = IMPORT_I18N_KEYS[importer]

  const onOk = async () => {
    setSelecting(true)
    try {
      // Select JSON export file
      const file = await window.api.file.open({
        filters: [{ name: t(i18nKeys.title), extensions: ['json'] }]
      })

      setSelecting(false)

      if (!file) {
        return
      }

      setImporting(true)

      // Parse file content
      const fileContent = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)

      // Import conversations
      const result = await ImportService.importConversations(fileContent, importer)

      if (result.success) {
        const skippedTopics = result.skippedTopicsCount ?? 0
        const skippedMessages = result.skippedMessagesCount ?? 0
        const successKey =
          importer === 'chatbox' && (skippedTopics > 0 || skippedMessages > 0)
            ? i18nKeys.successWithSkipped
            : i18nKeys.success

        window.toast.success(
          t(successKey, {
            topics: result.topicsCount,
            messages: result.messagesCount,
            skippedMessages,
            skippedTopics
          })
        )
        setOpen(false)
      } else {
        window.toast.error(result.error || t(i18nKeys.errorUnknown))
      }
    } catch (error) {
      window.toast.error(t(i18nKeys.errorUnknown))
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
      title={t(i18nKeys.title)}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      okText={t(i18nKeys.button)}
      okButtonProps={{ disabled: selecting || importing, loading: selecting }}
      cancelButtonProps={{ disabled: selecting || importing }}
      maskClosable={false}
      transitionName="animation-move-down"
      centered>
      {!selecting && !importing && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>{t(i18nKeys.description)}</div>
          <Alert
            message={t(i18nKeys.help.title)}
            description={
              <div>
                <p>{t(i18nKeys.help.step1)}</p>
                <p>{t(i18nKeys.help.step2)}</p>
                <p>{t(i18nKeys.help.step3)}</p>
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
          <div style={{ marginTop: 16 }}>{t(i18nKeys.selecting)}</div>
        </div>
      )}
      {importing && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Progress percent={100} status="active" strokeColor="var(--color-primary)" showInfo={false} />
          <div style={{ marginTop: 16 }}>{t(i18nKeys.importing)}</div>
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
  static show(options: { importer: Props['importer'] }) {
    return new Promise<PopupResult>((resolve) => {
      TopView.show(
        <PopupContainer
          importer={options.importer}
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
