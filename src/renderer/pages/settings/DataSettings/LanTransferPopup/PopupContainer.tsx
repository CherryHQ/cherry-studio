import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import type { PopupInjectedProps } from '@renderer/services/popup'
import { Smartphone } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { LanDeviceCard } from './LanDeviceCard'
import type { PopupResolveData } from './types'
import { useLanTransfer } from './useLanTransfer'

export const PopupContainer: FC<PopupInjectedProps<PopupResolveData>> = ({ open, resolve }) => {
  const { t } = useTranslation()

  const {
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

  const onOpenChange = (next: boolean) => {
    if (!next) {
      handleDialogCancel()
      resolve({})
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
