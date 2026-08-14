import { ConfirmDialog } from '@cherrystudio/ui'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { useIpcOn } from '@renderer/ipc'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Main refuses to bridge an agent through a disabled API gateway (it never starts it implicitly),
 * so it asks here instead. Enabling persists the preference, which is also what makes the gateway
 * come back on the next launch.
 *
 * Mounted at AppShell level (not inside AgentChat): the trigger fires from a Claude Code runtime
 * driver regardless of which tab is active, and the prompt must reach the user even when their
 * agent tab is in the background. Multiple sessions can race for the same prompt — only the first
 * one matters; later arrivals find `open` already true and re-enter the same dialog.
 *
 * Enabling is ALL this does. Resending the failed message would be a request the user never
 * approved, rebuilt from text alone — dropping attachments, knowledge scope and the reasoning /
 * fast-mode selection frozen with the original turn.
 */
export function ApiGatewayRequiredDialog() {
  const [open, setOpen] = useState(false)

  useIpcOn('api_gateway.required', () => {
    setOpen(true)
  })

  if (!open) return null
  return <GatewayPrompt onOpenChange={setOpen} />
}

function GatewayPrompt({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const { startApiGateway } = useApiGateway()
  const [enabling, setEnabling] = useState(false)
  const [failed, setFailed] = useState(false)

  const handleConfirm = async () => {
    setEnabling(true)
    try {
      // `startApiGateway` toasts its own failure and returns false (e.g. the port is taken).
      const ok = await startApiGateway()
      setFailed(!ok)
      if (ok) {
        onOpenChange(false)
      }
    } finally {
      setEnabling(false)
    }
  }

  // `ConfirmDialog` closes unconditionally once `onConfirm` settles. The event that raised this
  // prompt is transient, so letting a failed start close it would strand the user with no way back.
  const handleOpenChange = (next: boolean) => {
    if (!next && failed) {
      setFailed(false)
      return
    }
    onOpenChange(next)
  }

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
