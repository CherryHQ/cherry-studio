import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { Smartphone } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanTransfer } from './hook'
import { LanDeviceCard } from './LanDeviceCard'
import type { PopupContainerProps } from './types'

const CLOSE_ANIMATION_MS = 200

// Module-level callback for external hide access
let hideCallback: (() => void) | null = null
export const setHideCallback = (cb: () => void) => {
  hideCallback = cb
}
export const getHideCallback = () => hideCallback

export const PopupContainer: FC<PopupContainerProps> = ({ resolve }) => {
  const { t } = useTranslation()
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resolvedRef = useRef(false)

  const {
    state,
    lanDevices,
    isAnyTransferring,
    lastError,
    handleSendFile,
    handleModalCancel: handleDialogCancel,
    getTransferState,
    isConnected,
    isHandshakeInProgress
  } = useLanTransfer()

  const contentTitle = useMemo(() => t('settings.data.export_to_phone.lan.title'), [t])

  const resolveAfterClose = useCallback(() => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    closeTimerRef.current = setTimeout(() => {
      resolve({})
    }, CLOSE_ANIMATION_MS)
  }, [resolve])

  const onOpenChange = (next: boolean) => {
    if (!next) {
      handleDialogCancel()
    }
  }

  // Register hide callback for external access
  setHideCallback(handleDialogCancel)

  useEffect(() => {
    if (!state.open) {
      resolveAfterClose()
    }
  }, [resolveAfterClose, state.open])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contentTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {/* Error Display */}
          {lastError && <div className="text-error-base text-xs">{lastError}</div>}

          {/* Device List */}
          <div className="mt-2 flex flex-col gap-3">
            {lanDevices.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <Smartphone size={60} color="var(--color-foreground-muted)" />
                <span>{t('settings.data.export_to_phone.lan.no_connection_warning')}</span>
              </div>
            ) : (
              // Device cards
              lanDevices.map((service) => {
                const transferState = getTransferState(service.id)
                const connected = isConnected(service.id)
                const handshakeInProgress = isHandshakeInProgress(service.id)
                const isCardDisabled = isAnyTransferring || handshakeInProgress

                return (
                  <LanDeviceCard
                    key={service.id}
                    service={service}
                    transferState={transferState}
                    isConnected={connected}
                    handshakeInProgress={handshakeInProgress}
                    isDisabled={isCardDisabled}
                    onSendFile={handleSendFile}
                  />
                )
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
