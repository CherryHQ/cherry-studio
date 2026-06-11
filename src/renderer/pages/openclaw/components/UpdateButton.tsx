import { loggerService } from '@renderer/services/LoggerService'
import { ArrowUpCircle, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('UpdateButton')

export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string | null
  latestVersion: string | null
  message?: string
}

interface UpdateButtonProps {
  onUpdateComplete?: () => void
  onUpdatingChange?: (isUpdating: boolean) => void
}

const UpdateButton: FC<UpdateButtonProps> = ({ onUpdateComplete, onUpdatingChange }) => {
  const { t } = useTranslation()

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  // Notify parent when updating state changes
  useEffect(() => {
    onUpdatingChange?.(isUpdating)
  }, [isUpdating, onUpdatingChange])

  const checkUpdate = useCallback(async () => {
    try {
      const result = await window.api.openclaw.checkUpdate()
      setUpdateInfo(result)
    } catch (err) {
      logger.error('Failed to check for updates', err as Error)
    }
  }, [])

  const performUpdate = useCallback(async () => {
    setIsUpdating(true)
    try {
      const result = await window.api.openclaw.performUpdate()
      if (result.success) {
        setUpdateInfo(null)
        window.toast.success(t('openclaw.update.success'))
        onUpdateComplete?.()
      } else {
        window.toast.error(result.message)
      }
    } catch (err) {
      logger.error('Failed to update OpenClaw', err as Error)
      window.toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setIsUpdating(false)
    }
  }, [onUpdateComplete, t])

  // Check for updates on mount
  useEffect(() => {
    void checkUpdate()
  }, [checkUpdate])

  const handleClick = () => {
    if (isUpdating) return

    window.modal.confirm({
      title: t('openclaw.update.modal_title'),
      content: t('openclaw.update.available', {
        latest: updateInfo?.latestVersion,
        current: updateInfo?.currentVersion
      }),
      okText: t('openclaw.update.confirm_button'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: () => {
        // Start update without waiting, modal closes immediately
        void performUpdate()
      }
    })
  }

  // Don't render if no update available and not updating
  if (!updateInfo?.hasUpdate && !isUpdating) {
    return null
  }

  return (
    <span className="inline-flex cursor-pointer items-center gap-1" onClick={handleClick}>
      {isUpdating ? (
        <Loader2 className="size-3! animate-spin" style={{ color: 'var(--color-primary)' }} />
      ) : (
        <ArrowUpCircle className="size-3!" color="var(--color-primary)" />
      )}
      <span className="text-xs" style={{ color: 'var(--color-primary)' }}>
        {isUpdating ? t('openclaw.update.updating') : `v${updateInfo?.latestVersion}`}
      </span>
    </span>
  )
}

export default UpdateButton
