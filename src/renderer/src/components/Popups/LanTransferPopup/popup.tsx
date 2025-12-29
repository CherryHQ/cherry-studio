import { Modal } from 'antd'
import { TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useLanTransfer } from './hook'
import { LanDeviceCard } from './LanDeviceCard'
import type { PopupContainerProps } from './types'

// Module-level callback for external hide access
let hideCallback: (() => void) | null = null
export const setHideCallback = (cb: () => void) => {
  hideCallback = cb
}
export const getHideCallback = () => hideCallback

export const PopupContainer: FC<PopupContainerProps> = ({ resolve }) => {
  const { t } = useTranslation()

  const {
    state,
    lanDevices,
    isAnyTransferring,
    lastError,
    handleSendFile,
    handleModalCancel,
    getTransferState,
    isConnected,
    isHandshakeInProgress
  } = useLanTransfer()

  const contentTitle = useMemo(() => t('settings.data.export_to_phone.lan.title'), [t])

  const onClose = () => resolve({})

  // Register hide callback for external access
  setHideCallback(handleModalCancel)

  return (
    <Modal
      open={state.open}
      onCancel={handleModalCancel}
      afterClose={onClose}
      footer={null}
      centered
      title={contentTitle}
      transitionName="animation-move-down">
      <div className="flex flex-col gap-3">
        {/* Error Display */}
        {lastError && <div className="text-[var(--color-error)] text-xs">{lastError}</div>}

        {/* Device List */}
        <div className="mt-2 flex flex-col gap-3">
          {lanDevices.length === 0 ? (
            // Warning when no devices
            <div className="flex w-full items-center gap-2.5 rounded-[10px] border border-[rgba(255,159,41,0.4)] border-dashed bg-[rgba(255,159,41,0.1)] px-3.5 py-3">
              <TriangleAlert size={20} className="text-orange-400" />
              <span className="flex-1 text-[#ff9f29] text-[13px] leading-[1.4]">
                {t('settings.data.export_to_phone.lan.no_connection_warning')}
              </span>
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
    </Modal>
  )
}
