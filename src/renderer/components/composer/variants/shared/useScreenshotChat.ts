import { useCallback, useEffect, useMemo } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import type { ProviderActionHandlers } from './composerProviderActions'

const logger = loggerService.withContext('useScreenshotChat')
// One capture session exists at a time; retain its receipt across composer remounts.
let acceptedDeliveryId: string | undefined

export function useScreenshotChat({
  scopeKey,
  editingId,
  active,
  actionsRef,
  setFiles,
  isBlocked
}: {
  scopeKey: string
  editingId?: string | number
  active: boolean
  actionsRef: MutableRefObject<ProviderActionHandlers>
  setFiles: Dispatch<SetStateAction<ComposerAttachment[]>>
  isBlocked: () => boolean
}) {
  const { t } = useTranslation()
  const isActiveTab = useIsActiveTab()
  const [enabled] = usePreference('feature.screenshot.enabled')
  const target = useMemo(
    () => JSON.stringify([scopeKey, editingId, active, isActiveTab, crypto.randomUUID()]),
    [scopeKey, editingId, active, isActiveTab]
  )
  const startScreenshot = useCallback(() => {
    void ipcApi.request('screenshot.capture').catch((error) => {
      logger.error('Failed to start screenshot capture', error)
      toast.error(t('common.error'))
    })
  }, [t])
  useEffect(() => {
    if (!active || !isActiveTab) return
    void ipcApi
      .request('screenshot.chat_target', { scopeKey: target })
      .catch((error) => logger.error('Failed to register screenshot target', error))
    return () => {
      void ipcApi
        .request('screenshot.chat_target', { scopeKey: null })
        .catch((error) => logger.error('Failed to clear screenshot target', error))
    }
  }, [active, isActiveTab, target])
  useIpcOn('screenshot.chat_attachment', ({ deliveryId, scopeKey: destination, path, name, size, text }) => {
    const report = (accepted: boolean) => {
      void ipcApi
        .request('screenshot.chat_received', { deliveryId, accepted })
        .catch((error) => logger.error('Failed to acknowledge screenshot', error))
    }
    if (acceptedDeliveryId === deliveryId) return report(true)
    if (!active || !isActiveTab) return
    if (destination !== target || isBlocked()) return report(false)
    const parsed = AbsoluteFilePathSchema.safeParse(path)
    if (!parsed.success || !actionsRef.current.appendText(text)) return report(false)
    setFiles((previous) => [
      ...previous,
      {
        fileTokenSourceId: createComposerFileTokenSourceId(),
        path: parsed.data,
        name,
        origin_name: name,
        size,
        ext: '.png',
        type: FILE_TYPE.IMAGE
      }
    ])
    acceptedDeliveryId = deliveryId
    report(true)
    actionsRef.current.focus('end')
  })
  return { screenshotEnabled: enabled, startScreenshot }
}
