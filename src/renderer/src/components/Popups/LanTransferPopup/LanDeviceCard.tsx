import { cn } from '@renderer/utils'
import type { FC, KeyboardEventHandler } from 'react'
import { useTranslation } from 'react-i18next'

import { ProgressIndicator } from './ProgressIndicator'
import type { LanDeviceCardProps } from './types'

export const LanDeviceCard: FC<LanDeviceCardProps> = ({
  service,
  transferState,
  isConnected,
  handshakeInProgress,
  isDisabled,
  onSendFile
}) => {
  const { t } = useTranslation()

  // Device info
  const deviceName = service.txt?.modelName || t('common.unknown')
  const platform = service.txt?.platform
  const appVersion = service.txt?.appVersion
  const platformInfo = [platform, appVersion].filter(Boolean).join(' ')
  const displayTitle = platformInfo ? `${deviceName} (${platformInfo})` : deviceName

  // Address info
  const primaryAddress = service.addresses?.[0]
  const addressesWithPort = primaryAddress ? (service.port ? `${primaryAddress}:${service.port}` : primaryAddress) : ''

  // Progress visibility
  const shouldShowProgress =
    transferState && ['selecting', 'transferring', 'completed', 'failed'].includes(transferState.status)

  // Status text
  const statusText = handshakeInProgress
    ? t('settings.data.export_to_phone.lan.handshake.in_progress')
    : isConnected
      ? t('settings.data.export_to_phone.lan.connected')
      : t('settings.data.export_to_phone.lan.send_file')

  // Event handlers
  const handleClick = () => {
    if (isDisabled) return
    onSendFile(service.id)
  }

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleClick()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        // Base styles
        'flex cursor-pointer flex-col gap-2 rounded-xl border p-3 outline-none transition-all duration-[120ms]',
        // Hover state
        'hover:-translate-y-px hover:border-[var(--color-primary-hover)] hover:shadow-md',
        // Focus state
        'focus-visible:border-[var(--color-primary)] focus-visible:shadow-[0_0_0_2px_rgba(24,144,255,0.2)]',
        // Connected state
        isConnected
          ? 'border-[var(--color-primary)] bg-[rgba(24,144,255,0.04)]'
          : 'border-[var(--color-border)] bg-[var(--color-background)]',
        // Disabled state
        isDisabled && 'pointer-events-none translate-y-0 opacity-70 shadow-none'
      )}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="break-words font-semibold text-[var(--color-text-1)] text-sm">{displayTitle}</div>
          <span className="text-[var(--color-text-2)] text-xs">{statusText}</span>
        </div>
      </div>

      {/* Meta Row - IP Address */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--color-text-3)] uppercase tracking-[0.03em]">
          {t('settings.data.export_to_phone.lan.ip_addresses')}
        </span>
        <span className="break-words text-[var(--color-text)] text-xs">{addressesWithPort || t('common.unknown')}</span>
      </div>

      {/* Footer with Progress */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-text-3)]">
        {shouldShowProgress && transferState && (
          <ProgressIndicator transferState={transferState} handshakeInProgress={handshakeInProgress} />
        )}
      </div>
    </div>
  )
}
