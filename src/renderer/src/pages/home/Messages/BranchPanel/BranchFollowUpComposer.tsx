import { Button, Textarea } from '@cherrystudio/ui'
import { SendHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { handleBranchComposerKeyDown } from './composerKeyboard'

interface Props {
  /** Emits the trimmed follow-up text. The host routes it to THIS card's branch topic. */
  onSend: (followUp: string) => void
}

/**
 * BranchFollowUpComposer — conversation-state composer (P1-S2b-2).
 *
 * Append a turn to the branch conversation already open in this detail block.
 * Per-branch isolation: the draft text lives in THIS component's local state,
 * so typing in branch B never bleeds into A. Routing to the right branch topic
 * is the host's job (Chat.tsx resolves branchId → topic); this only emits
 * `onSend(text)`.
 *
 * Keyboard (P1-S2c B3): shares the ONE `handleBranchComposerKeyDown` handler
 * with the initial-ask `BranchComposer` — Enter sends, Shift+Enter newlines,
 * IME-compose Enter doesn't send.
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
        onKeyDown={(event) => handleBranchComposerKeyDown(event, handleSend)}
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
