import { Button, Textarea } from '@cherrystudio/ui'
import { SendHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  /** Emits the trimmed follow-up text. The host routes it to THIS card's branch topic. */
  onSend: (followUp: string) => void
}

/**
 * BranchFollowUpComposer — P1-S2b-2 conversation-state composer.
 *
 * The deferred-from-S2b-1 piece: a small textarea + Send affordance pinned to
 * the bottom of an open branch card's conversation body. Unlike
 * `BranchComposer` (which is the compose-state form: quote block, "create
 * branch" button, Cancel == close-branch), this is just "append a turn to the
 * conversation already in this card" — so it is intentionally minimal and
 * separate rather than a mode flag on BranchComposer.
 *
 * Per-card isolation: the draft text lives in THIS component's local state, so
 * typing in branch B's composer never bleeds into A's or C's. Routing to the
 * correct branch topic is the host's job (Chat.tsx resolves branchId → topic);
 * this component only knows how to emit `onSend(text)`.
 *
 * Streaming / loading feedback is intentionally NOT modelled here — the reply
 * streams into the card's own <BranchMessageStream>. (Per-card streaming-state
 * polish is deferred; see P1-S2b-2 README.)
 */
export default function BranchFollowUpComposer({ onSend }: Props) {
  const { t } = useTranslation()
  const [followUp, setFollowUp] = useState('')
  const [validationError, setValidationError] = useState<string | undefined>(undefined)

  const handleSend = () => {
    const trimmed = followUp.trim()
    if (!trimmed) {
      setValidationError(t('chat.message.anchor.panel.error.followup_required'))
      return
    }
    setValidationError(undefined)
    onSend(trimmed)
    setFollowUp('')
  }

  const handleChange = (value: string) => {
    setFollowUp(value)
    if (validationError) setValidationError(undefined)
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 border-border border-t p-3" data-testid="branch-followup-composer">
      <Textarea.Input
        value={followUp}
        onValueChange={handleChange}
        placeholder={t('chat.message.anchor.panel.follow_up_placeholder')}
        rows={2}
        aria-label={t('chat.message.anchor.panel.follow_up_label')}
      />
      {validationError && (
        <div className="text-destructive text-xs" data-testid="branch-followup-validation-error">
          {validationError}
        </div>
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSend} data-testid="branch-followup-send">
          <SendHorizontal className="mr-2 h-4 w-4" />
          {t('chat.message.anchor.panel.send')}
        </Button>
      </div>
    </div>
  )
}
