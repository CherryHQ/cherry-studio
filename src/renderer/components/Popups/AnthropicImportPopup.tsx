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
import { loggerService } from '@logger'
import { ImportService } from '@renderer/services/import'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const logger = loggerService.withContext('AnthropicImportPopup')

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
      // Select Claude JSON file
      const file = await window.api.file.open({
        filters: [{ name: 'Claude Conversations', extensions: ['json'] }]
      })

      setSelecting(false)

      if (!file) {
        return
      }

      setImporting(true)

      // Parse file content
      const fileContent = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)

      // Import conversations
      const result = await ImportService.importConversations(fileContent, 'claude')

      if (result.success) {
        window.toast.success(
          t('import.claude.success', {
            topics: result.topicsCount,
            messages: result.messagesCount
          })
        )
        setOpen(false)
      } else {
        window.toast.error(result.error || t('import.claude.error.unknown'))
      }
    } catch (error) {
      logger.error('Claude import failed:', error as Error)
      window.toast.error(t('import.claude.error.unknown'))
      setOpen(false)
    } finally {
      setSelecting(false)
      setImporting(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  AnthropicImportPopup.hide = onCancel

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="sm:max-w-[520px]" onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('import.claude.title')}</DialogTitle>
        </DialogHeader>
        {!selecting && !importing && (
          <div className="flex w-full flex-col gap-3">
            <div>{t('import.claude.description')}</div>
            <Alert
              message={t('import.claude.help.title')}
              description={
                <div>
                  <p>{t('import.claude.help.step1')}</p>
                  <p>{t('import.claude.help.step2')}</p>
                  <p>{t('import.claude.help.step3')}</p>
                </div>
              }
              type="info"
              showIcon
            />
          </div>
        )}
        {selecting && (
          <div className="flex justify-center py-10">
            <Spinner text={t('import.claude.selecting')} />
          </div>
        )}
        {importing && (
          <div className="flex justify-center py-5">
            <Spinner text={t('import.claude.importing')} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={selecting || importing} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button loading={selecting} disabled={importing} onClick={onOk}>
            {t('import.claude.button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'AnthropicImportPopup'

export default class AnthropicImportPopup {
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
