import {
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { getRestoreProgressLabelKey } from '@renderer/i18n/label'
import { restore } from '@renderer/services/BackupService'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = PopupInjectedProps<any>

interface ProgressData {
  stage: string
  progress: number
  total: number
}

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const [progressData, setProgressData] = useState<ProgressData>()
  const { t } = useTranslation()

  useEffect(() => {
    const removeListener = window.electron.ipcRenderer.on(IpcChannel.RestoreProgress, (_, data: ProgressData) => {
      setProgressData(data)
    })

    return () => {
      removeListener()
    }
  }, [])

  const onOk = async () => {
    await restore()
    resolve({})
  }

  const onCancel = () => {
    resolve({})
  }

  const getProgressText = () => {
    if (!progressData) return ''

    if (progressData.stage === 'copying_files') {
      return t('restore.progress.copying_files', {
        progress: Math.floor(progressData.progress)
      })
    }
    return t(getRestoreProgressLabelKey(progressData.stage))
  }

  const isDisabled = progressData ? progressData.stage !== 'completed' : false

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        closeOnOverlayClick={false}
        className="sm:max-w-[520px]"
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('restore.title')}</DialogTitle>
        </DialogHeader>
        {!progressData && <div>{t('restore.content')}</div>}
        {progressData && (
          <div className="flex flex-col items-center gap-4 py-5 text-center">
            <CircularProgress
              value={Math.floor(progressData.progress)}
              size={72}
              strokeWidth={6}
              showLabel
              renderLabel={(progress) => `${progress}%`}
            />
            <div>{getProgressText()}</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={isDisabled} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={isDisabled} onClick={onOk}>
            {t('restore.confirm.button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const RestorePopup = createPopup<Record<string, never>, any>(PopupContainer, { dismissResult: {} })

export default RestorePopup
