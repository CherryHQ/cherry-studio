import { ConfirmDialog } from '@cherrystudio/ui'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { useIpcOn } from '@renderer/ipc'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  sessionId: string
  messages: CherryUIMessage[]
  sendMessage: (message?: { text: string }) => Promise<void>
}

/**
 * Main refuses to bridge an agent through a disabled API gateway (it never starts it implicitly),
 * so it asks here instead. Enabling persists the preference, which is also what makes the gateway
 * come back on the next launch.
 */
export function ApiGatewayRequiredDialog({ sessionId, messages, sendMessage }: Props) {
  const { t } = useTranslation()
  const { startApiGateway } = useApiGateway()
  const [open, setOpen] = useState(false)

  useIpcOn('api_gateway.required', (payload) => {
    if (payload.sessionId === sessionId) setOpen(true)
  })

  const handleConfirm = async () => {
    // `startApiGateway` toasts its own failure and returns false (e.g. the port is taken).
    if (!(await startApiGateway())) return
    const text = retryText(messages)
    if (text) await sendMessage({ text })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={t('apiGateway.required.title')}
      description={t('apiGateway.required.description')}
      confirmText={t('apiGateway.required.confirm')}
      cancelText={t('common.cancel')}
      onConfirm={handleConfirm}
    />
  )
}

/**
 * The prompt also fires when merely opening a session (the runtime primes an idle connection), so
 * only a turn that actually failed is worth resending.
 */
function retryText(messages: CherryUIMessage[]): string | undefined {
  const last = messages.at(-1)
  if (last?.role !== 'assistant' || last.metadata?.status !== 'error') return undefined
  const lastUserMessage = messages.findLast((message) => message.role === 'user')
  if (!lastUserMessage) return undefined
  // ponytail: text only, and the failed turn stays in the history. Revisit if resending
  // attachments or hiding the failed turn is actually asked for.
  return getTextFromParts((lastUserMessage.parts ?? []) as CherryMessagePart[]).trim() || undefined
}
