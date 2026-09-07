import { ConfirmDialog } from '@cherrystudio/ui'
import { useMandatoryGateOpen } from '@renderer/components/MandatoryGateProvider'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { useIpcOn } from '@renderer/ipc'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  sessionId: string
}

/**
 * Main refuses to bridge an agent through a disabled API gateway (it never starts it implicitly),
 * so it asks here instead. Enabling persists the preference, which is also what makes the gateway
 * come back on the next launch.
 *
 * Enabling is ALL this does. Resending the failed message would be a request the user never
 * approved, rebuilt from text alone — dropping attachments, knowledge scope and the reasoning /
 * fast-mode selection frozen with the original turn.
 */
export function ApiGatewayRequiredDialog({ sessionId }: Props) {
  const [open, setOpen] = useState(false)
  // A mandatory gate (privacy update) owns the window; the prompt waits rather than stacking on it.
  const mandatoryGateOpen = useMandatoryGateOpen()

  useIpcOn('api_gateway.required', (payload) => {
    if (payload.sessionId === sessionId) setOpen(true)
  })

  // Every agent chat renders this, but the prompt is rare — keep the gateway preference and
  // shared-cache subscriptions out of the common path until it actually fires.
  if (!open || mandatoryGateOpen) return null
  return <GatewayPrompt onOpenChange={setOpen} />
}

function GatewayPrompt({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const { startApiGateway } = useApiGateway()
  const [enabling, setEnabling] = useState(false)
  const failed = useRef(false)

  const handleConfirm = async () => {
    setEnabling(true)
    try {
      // `startApiGateway` toasts its own failure and returns false (e.g. the port is taken).
      failed.current = !(await startApiGateway())
    } finally {
      setEnabling(false)
    }
  }

  // `ConfirmDialog` closes unconditionally once `onConfirm` settles. The event that raised this
  // prompt is transient, so letting a failed start close it would strand the user with no way back.
  const handleOpenChange = (next: boolean) => {
    if (!next && failed.current) {
      failed.current = false
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
