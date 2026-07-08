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
import { importChatGPTConversations } from '@renderer/services/import'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ImportPopup')

interface PopupResult {
  success?: boolean
}

type Props = PopupInjectedProps<PopupResult>

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const [selecting, setSelecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const { t } = useTranslation()

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
        toast.success(
          t('import.chatgpt.success', {
            topics: result.topicsCount,
            messages: result.messagesCount
          })
        )
        resolve({})
      } else {
        toast.error(result.error || t('import.chatgpt.error.unknown'))
      }
    } catch (error) {
      logger.error('ChatGPT import failed:', error as Error)
      toast.error(t('import.chatgpt.error.unknown'))
      resolve({})
    } finally {
      setSelecting(false)
      setImporting(false)
    }
  }

  const onCancel = () => {
    resolve({})
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        closeOnOverlayClick={false}
        className="sm:max-w-[520px]"
        onPointerDownOutside={(event) => event.preventDefault()}>
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

const ImportPopup = createPopup<Record<string, never>, PopupResult>(PopupContainer, { dismissResult: {} })

export default ImportPopup
