import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { importService } from '@renderer/services/import'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

const logger = loggerService.withContext('ImportPopup')

interface PopupResult {
  success?: boolean
}

type ImportSource = 'chatgpt' | 'claude'

interface OwnProps {
  source: ImportSource
}

type Props = OwnProps & PopupInjectedProps<PopupResult>

const IMPORT_CONFIG = {
  chatgpt: {
    loggerName: 'ChatGPT',
    translations: {
      button: 'import.chatgpt.button',
      description: 'import.chatgpt.description',
      helpStep1: 'import.chatgpt.help.step1',
      helpStep2: 'import.chatgpt.help.step2',
      helpStep3: 'import.chatgpt.help.step3',
      helpTitle: 'import.chatgpt.help.title',
      importing: 'import.chatgpt.importing',
      selecting: 'import.chatgpt.selecting',
      success: 'import.chatgpt.success',
      title: 'import.chatgpt.title',
      unknownError: 'import.chatgpt.error.unknown'
    }
  },
  claude: {
    loggerName: 'Claude',
    translations: {
      button: 'import.claude.button',
      description: 'import.claude.description',
      helpStep1: 'import.claude.help.step1',
      helpStep2: 'import.claude.help.step2',
      helpStep3: 'import.claude.help.step3',
      helpTitle: 'import.claude.help.title',
      importing: 'import.claude.importing',
      selecting: 'import.claude.selecting',
      success: 'import.claude.success',
      title: 'import.claude.title',
      unknownError: 'import.claude.error.unknown'
    }
  }
} as const

const PopupContainer: React.FC<Props> = ({ open, resolve, source }) => {
  const [selecting, setSelecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const { t } = useTranslation()
  const config = IMPORT_CONFIG[source]
  const translations = config.translations

  const onOk = async () => {
    setSelecting(true)
    try {
      // Select conversation JSON file
      const file = await window.api.file.open({
        filters: [{ name: t(translations.title), extensions: ['json'] }]
      })

      setSelecting(false)

      if (!file) {
        return
      }

      setImporting(true)
      setImportProgress(0)

      // Parse file content
      const fileContent = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)

      // Import conversations
      const result = await importService.importConversations(fileContent, source, setImportProgress)

      if (result.success) {
        toast.success(
          t(translations.success, {
            topics: result.topicsCount,
            messages: result.messagesCount
          })
        )
        resolve({})
      } else {
        toast.error(result.error || t(translations.unknownError))
      }
    } catch (error) {
      logger.error(`${config.loggerName} import failed:`, error as Error)
      toast.error(t(translations.unknownError))
      resolve({})
    } finally {
      setSelecting(false)
      setImporting(false)
      setImportProgress(0)
    }
  }

  const onCancel = () => {
    resolve({})
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        closeOnOverlayClick={false}
        size="default"
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t(translations.title)}</DialogTitle>
        </DialogHeader>
        <div className="flex w-full flex-col gap-3">
          <div>{t(translations.description)}</div>
          {importing ? (
            <div className="flex flex-col gap-2 py-2">
              <div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
                <span>{t(translations.importing)}</span>
                <span className="tabular-nums">{importProgress}%</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-label={t(translations.importing)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={importProgress}>
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <Alert
              message={t(translations.helpTitle)}
              description={
                <div>
                  <p>{t(translations.helpStep1)}</p>
                  <p>{t(translations.helpStep2)}</p>
                  <p>{t(translations.helpStep3)}</p>
                </div>
              }
              type="info"
              showIcon
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={selecting || importing} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="emphasis" loading={selecting} disabled={importing} onClick={onOk}>
            {t(translations.button)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ImportPopup = createPopup<OwnProps, PopupResult>(PopupContainer, { dismissResult: {} })

export default ImportPopup
