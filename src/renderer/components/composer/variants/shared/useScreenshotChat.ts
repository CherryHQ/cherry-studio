import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useOptionalQuickPanel } from '@renderer/components/QuickPanel'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'

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
  const closeQuickPanel = useOptionalQuickPanel()?.close
  const [enabled] = usePreference('feature.screenshot.enabled')
  const target = useMemo(
    () => JSON.stringify([scopeKey, editingId, active, isActiveTab, crypto.randomUUID()]),
    [scopeKey, editingId, active, isActiveTab]
  )
  const startScreenshot = useCallback(() => {
    closeQuickPanel?.('screenshot')
    void ipcApi.request('chat.screenshot.capture').catch((error) => {
      logger.error('Failed to start screenshot capture', error)
      toast.error(t('common.error'))
    })
  }, [closeQuickPanel, t])
  useEffect(() => {
    if (!active || !isActiveTab) return
    void ipcApi
      .request('chat.screenshot.target', { scopeKey: target })
      .catch((error) => logger.error('Failed to register screenshot target', error))
    return () => {
      void ipcApi
        .request('chat.screenshot.target', { scopeKey: null })
        .catch((error) => logger.error('Failed to clear screenshot target', error))
    }
  }, [active, isActiveTab, target])
  const receiver = useRef({ active: false, target, isBlocked, actionsRef, setFiles, closeQuickPanel })
  receiver.current = { active: active && isActiveTab, target, isBlocked, actionsRef, setFiles, closeQuickPanel }
  const mounted = useRef(false)
  const pending = useRef(new Set<string>())
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useIpcOn('chat.screenshot.attachment', ({ deliveryId, scopeKey: destination, imageUrl, name, size, text }) => {
    const report = (accepted: boolean) => {
      void ipcApi
        .request('chat.screenshot.received', { deliveryId, accepted })
        .catch((error) => logger.error('Failed to acknowledge screenshot', error))
    }
    if (acceptedDeliveryId === deliveryId) return report(true)
    if (!active || !isActiveTab || pending.current.has(deliveryId)) return
    if (destination !== target || isBlocked()) return report(false)
    pending.current.add(deliveryId)
    void (async () => {
      try {
        const response = await fetch(imageUrl)
        if (!response.ok) throw new Error('Screenshot resource is no longer available')
        const blob = await response.blob()
        const current = receiver.current
        if (!mounted.current || !current.active || current.target !== destination || current.isBlocked()) {
          return report(false)
        }
        if (blob.type !== 'image/png' || blob.size !== size || !current.actionsRef.current.appendText(text)) {
          return report(false)
        }
        current.closeQuickPanel?.('screenshot')
        current.setFiles((previous) => [
          ...previous,
          {
            fileTokenSourceId: createComposerFileTokenSourceId(),
            blob,
            name,
            origin_name: name,
            size,
            ext: '.png',
            type: FILE_TYPE.IMAGE
          }
        ])
        acceptedDeliveryId = deliveryId
        report(true)
        current.actionsRef.current.focus('end')
      } catch (error) {
        logger.error('Failed to receive screenshot', error as Error)
        report(false)
      } finally {
        pending.current.delete(deliveryId)
      }
    })()
  })
  return { screenshotEnabled: enabled, startScreenshot }
}
