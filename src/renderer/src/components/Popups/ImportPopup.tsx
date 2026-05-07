import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner
} from '@cherrystudio/ui'
import { importChatGPTConversations } from '@renderer/services/import'
import { useEffect, useRef, useState } from 'react'
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
  const resolvedRef = useRef(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (open || resolvedRef.current) return

    resolvedRef.current = true
    resolve({})
  }, [open, resolve])

  const onOk = async () => {
    setSelecting(true)
    try {
      // Select ChatGPT JSON file
      const file = await window.api.file.open({
        filters: [{ name: 'ChatGPT Conversations', extensions: ['json'] }]
      })

      setSelecting(false)

      if (!file) {
        return
      }

      setImporting(true)

      // Parse file content
      const fileContent = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)

      // Import conversations
      const result = await importChatGPTConversations(fileContent)

      if (result.success) {
        window.toast.success(
          t('import.chatgpt.success', {
            topics: result.topicsCount,
            messages: result.messagesCount
          })
        )
        setOpen(false)
      } else {
        window.toast.error(result.error || t('import.chatgpt.error.unknown'))
      }
    } catch (error) {
      window.toast.error(t('import.chatgpt.error.unknown'))
      setOpen(false)
    } finally {
      setSelecting(false)
      setImporting(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  ImportPopup.hide = onCancel

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="sm:max-w-[520px]" onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('import.chatgpt.title')}</DialogTitle>
        </DialogHeader>
        {!selecting && !importing && (
          <div className="flex w-full flex-col gap-3">
            <div>{t('import.chatgpt.description')}</div>
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
            />
          </div>
        )}
        {selecting && (
          <div className="flex justify-center py-10">
            <Spinner text={t('import.chatgpt.selecting')} />
          </div>
        )}
        {importing && (
          <div className="flex justify-center py-5">
            <Spinner text={t('import.chatgpt.importing')} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={selecting || importing} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button loading={selecting} disabled={importing} onClick={onOk}>
            {t('import.chatgpt.button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
