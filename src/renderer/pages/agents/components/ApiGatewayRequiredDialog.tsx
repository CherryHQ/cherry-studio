import { ConfirmDialog } from '@cherrystudio/ui'
import { isHiddenPart } from '@renderer/components/chat/messages/blocks/messagePartLayouts'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { useIpcOn } from '@renderer/ipc'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { API_GATEWAY_REQUIRED_I18N_KEY } from '@shared/types/apiGateway'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  sessionId: string
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  sendMessage: (message?: { text: string }) => Promise<void>
}

/**
 * Main refuses to bridge an agent through a disabled API gateway (it never starts it implicitly),
 * so it asks here instead. Enabling persists the preference, which is also what makes the gateway
 * come back on the next launch.
 */
export function ApiGatewayRequiredDialog({ sessionId, messages, partsByMessageId, sendMessage }: Props) {
  const [open, setOpen] = useState(false)

  useIpcOn('api_gateway.required', (payload) => {
    if (payload.sessionId === sessionId) setOpen(true)
  })

  // Every agent chat renders this, but the prompt is rare — keep the gateway preference and
  // shared-cache subscriptions out of the common path until it actually fires.
  if (!open) return null
  return (
    <GatewayPrompt
      messages={messages}
      partsByMessageId={partsByMessageId}
      sendMessage={sendMessage}
      onOpenChange={setOpen}
    />
  )
}

function GatewayPrompt({
  messages,
  partsByMessageId,
  sendMessage,
  onOpenChange
}: Omit<Props, 'sessionId'> & { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const { startApiGateway } = useApiGateway()
  const [enabling, setEnabling] = useState(false)
  const inFlight = useRef(false)
  const failed = useRef(false)

  const handleConfirm = async () => {
    // The confirm button only disables once React commits `enabling`, so a fast double-click can
    // enter twice and resend twice. The ref closes that window synchronously.
    if (inFlight.current) return
    inFlight.current = true
    setEnabling(true)
    try {
      // `startApiGateway` toasts its own failure and returns false (e.g. the port is taken).
      failed.current = !(await startApiGateway())
      if (failed.current) return
      const text = retryText(messages, partsByMessageId)
      if (text) await sendMessage({ text })
    } finally {
      inFlight.current = false
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

/**
 * Text to resend, or `undefined` when nothing may be resent.
 *
 * Opening a session primes an idle connection, so the prompt also fires with no turn behind it —
 * over history that may end in an unrelated failure. Resend ONLY when the last turn died on this
 * error and produced nothing else: the gateway refuses before the agent subprocess is spawned, so
 * such a turn provably burned no tokens and ran no tools. Any other terminal error, or an error
 * next to real output (a mid-turn connection rebuild), would duplicate work that already happened.
 */
export function retryText(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): string | undefined {
  const last = messages.at(-1)
  if (last?.role !== 'assistant' || last.metadata?.status !== 'error') return undefined
  const shown = partsOf(last, partsByMessageId).filter((part) => !isHiddenPart(part))
  const failedOnGatewayAlone =
    shown.length === 1 && shown[0].type === 'data-error' && shown[0].data?.i18nKey === API_GATEWAY_REQUIRED_I18N_KEY
  if (!failedOnGatewayAlone) return undefined
  const lastUserMessage = messages.findLast((message) => message.role === 'user')
  if (!lastUserMessage) return undefined
  // ponytail: text only, and the failed turn stays in the history. Revisit if resending
  // attachments or hiding the failed turn is actually asked for.
  return getTextFromParts(partsOf(lastUserMessage, partsByMessageId)).trim() || undefined
}

/** Streaming layers own the live parts; a message read back from history carries its own. */
function partsOf(message: CherryUIMessage, partsByMessageId: Record<string, CherryMessagePart[]>): CherryMessagePart[] {
  return partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
}
