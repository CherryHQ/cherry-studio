import { ConfirmDialog } from '@cherrystudio/ui'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { useIpcOn } from '@renderer/ipc'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Window-level API gateway required dialog.
 *
 * Moved from per-agent-tab mount (AgentChat) to the AppShell level so that:
 * - There is exactly one stable dialog host in the window, not one per tab.
 * - The dialog remains visible even if the originating session's tab becomes
 *   dormant or unmounted while the gateway start is in-flight.
 * - We avoid each active agent tab subscribing to the same broadcast.
 */
export function ApiGatewayRequiredDialog() {
  const { t } = useTranslation()
  const { startApiGateway } = useApiGateway()
  const [open, setOpen] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const failed = useRef(false)

  useIpcOn('api_gateway.required', () => {
    setOpen(true)
  })

  const handleConfirm = async () => {
    setEnabling(true)
    try {
      // `startApiGateway` toasts its own failure and returns false (e.g. the port is taken).
      failed.current = !(await startApiGateway())
    } finally {
      setEnabling(false)
    }
  }

  // `ConfirmDialog` closes unconditionally once `onConfirm` settles. The event
  // that raised this prompt is transient, so letting a failed start close it
  // would strand the user with no way back.
  const handleOpenChange = (next: boolean) => {
    if (!next && failed.current) {
      failed.current = false
      return
    }
    setOpen(next)
  }

  if (!open) return null

  return (
    <ConfirmDialog
      open
      onOpenChange={handleOpenChange}
      title={t('apiGateway.required.title')}
      description={t('apiGateway.required.description')}
      confirmText={t('apiGateway.required.confirm')}
      cancelText={t('common.cancel')}
      confirmLoading={enabling}
      onConfirm={handleConfirm}
    />
  )
}
