import type { DropzoneProps } from '@cherrystudio/ui'
import type { InstallPreview } from '@renderer/hooks/useMiniAppInstallPreview'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type SettlePreview = (run: () => Promise<InstallPreview | null>, errorKey: string) => Promise<void>

type MiniAppPackageDropOptions = Pick<
  DropzoneProps,
  | 'getFilesFromEvent'
  | 'maxFiles'
  | 'multiple'
  | 'noClick'
  | 'noKeyboard'
  | 'validator'
  | 'onDropAccepted'
  | 'onDropRejected'
>

const getFilesFromEvent: NonNullable<DropzoneProps['getFilesFromEvent']> = async (event) =>
  'dataTransfer' in event && event.dataTransfer ? Array.from(event.dataTransfer.files) : []

const validateMiniAppPackage: NonNullable<DropzoneProps['validator']> = (file) =>
  file.name.toLowerCase().endsWith('.miniapp')
    ? null
    : { code: 'file-invalid-type', message: 'Expected a .miniapp package' }

export function useMiniAppPackageDrop(settle: SettlePreview): MiniAppPackageDropOptions {
  const { t } = useTranslation()

  const previewPackage = useCallback(
    (files: File[]) => {
      const file = files[0]
      if (!file) {
        toast.error(t('miniApp.install.drop_invalid'))
        return
      }

      const filePath = AbsoluteFilePathSchema.safeParse(window.api.file.getPathForFile(file))
      if (!filePath.success) {
        toast.error(t('miniApp.install.drop_invalid'))
        return
      }

      void settle(
        () => ipcApi.request('mini_app.install.preview_file', { filePath: filePath.data }),
        'miniApp.install.preview_error'
      )
    },
    [settle, t]
  )

  const rejectPackage = useCallback(() => toast.error(t('miniApp.install.drop_invalid')), [t])

  return {
    getFilesFromEvent,
    maxFiles: 1,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    validator: validateMiniAppPackage,
    onDropAccepted: previewPackage,
    onDropRejected: rejectPackage
  }
}
