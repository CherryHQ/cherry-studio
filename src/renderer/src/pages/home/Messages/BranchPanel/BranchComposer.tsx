import { Button, Textarea } from '@cherrystudio/ui'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { handleBranchComposerKeyDown } from './composerKeyboard'
import type { BranchAnchor } from './types'

type ForkStatus = 'idle' | 'creating' | 'error'

interface Props {
  /** The anchor captured from SelectionContextMenu — selectedText comes from here. */
  anchor: BranchAnchor
  /** Lifecycle from useBranchFork: idle | creating | error. */
  status: ForkStatus
  /** Translated error message; rendered only when status === 'error'. */
  errorMessage?: string
  /** Invoked with the trimmed follow-up text. */
  onCreate: (followUp: string) => void
  /** Cancel during compose state — clears the anchor in the host. */
  onCancel: () => void
}

/**
 * BranchComposer — T-006D-2B compose state for the side-by-side branch.
 *
 * Pure UI: owns the follow-up textarea + non-empty guard, surfaces
 * loading/error from `useBranchFork` via props, and emits the trimmed text
 * through `onCreate`. The host (BranchPane) decides what to do next (show
 * the conversation view in S4').
 *
 * Close behaviour: this component does not own anchor lifetime — the X button
 * lives in BranchPane's header. `onCancel` is the equivalent of "user clicked
 * Cancel in this form" and clears the anchor.
 */
export default function BranchComposer({ anchor, status, errorMessage, onCreate, onCancel }: Props) {
  const { t } = useTranslation()
  const [followUp, setFollowUp] = useState('')
  const [validationError, setValidationError] = useState<string | undefined>(undefined)

  // If the host re-anchors to a different selection mid-compose, reset draft
  // text so the textarea reflects the new context.
  useEffect(() => {
    setFollowUp('')
    setValidationError(undefined)
  }, [anchor.messageId, anchor.selectedText])

  const isCreating = status === 'creating'

  const handleCreate = () => {
    if (isCreating) return
    const trimmed = followUp.trim()
    if (!trimmed) {
      setValidationError(t('chat.message.anchor.panel.error.followup_required'))
      return
    }
    setValidationError(undefined)
    onCreate(trimmed)
  }

  const handleFollowUpChange = (value: string) => {
    setFollowUp(value)
    if (validationError) setValidationError(undefined)
  }

  const handleCancel = () => {
    if (isCreating) return
    onCancel()
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <div className="mb-1 text-muted-foreground text-xs">{t('chat.message.anchor.panel.from')}</div>
        <blockquote
          className="border-accent border-l-2 bg-accent/40 px-3 py-2 text-sm italic"
          data-testid="branch-composer-quote">
          {anchor.selectedText}
        </blockquote>
      </div>

      <div>
        <label className="mb-1 block font-medium text-sm" htmlFor="branch-composer-follow-up">
          {t('chat.message.anchor.panel.compose_label')}
        </label>
        <Textarea.Input
          id="branch-composer-follow-up"
          value={followUp}
          onValueChange={handleFollowUpChange}
          onKeyDown={(event) => handleBranchComposerKeyDown(event, handleCreate)}
          placeholder={t('chat.message.anchor.panel.follow_up_placeholder')}
          rows={4}
          readOnly={isCreating}
        />
        {validationError && (
          <div className="mt-1 text-destructive text-xs" data-testid="branch-composer-validation-error">
            {validationError}
          </div>
        )}
        {status === 'error' && errorMessage && (
          <div className="mt-1 text-destructive text-xs" data-testid="branch-composer-error">
            {errorMessage}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleCancel} disabled={isCreating}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleCreate} disabled={isCreating}>
          {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('chat.message.anchor.panel.create_branch')}
        </Button>
      </div>
    </div>
  )
}
