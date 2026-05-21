import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { BranchAnchor } from './types'

const logger = loggerService.withContext('BranchPanel')

interface Props {
  anchor: BranchAnchor | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * BranchPanel — T-006D-1 shell prototype.
 *
 * Receives an immutable `anchor` (the selection's messageId/blockId/text)
 * and lets the user draft a follow-up question. The "Create branch" action
 * currently only logs — T-006D-2 wires it to `POST /topics { sourceNodeId }`
 * and T-006E paints the highlight overlay.
 *
 * Local follow-up state is cleared whenever the panel closes so a re-open
 * (e.g. clicking another highlighted region in T-006E) starts fresh.
 */
const BranchPanel: React.FC<Props> = ({ anchor, open, onOpenChange }) => {
  const { t } = useTranslation()
  const [followUp, setFollowUp] = useState('')

  useEffect(() => {
    if (!open) setFollowUp('')
  }, [open])

  const handleCancel = () => {
    onOpenChange(false)
  }

  const handleCreateBranch = () => {
    if (!anchor) return
    logger.debug('branch-panel: create branch (placeholder, T-006D-2 wires fork)', {
      messageId: anchor.messageId,
      blockId: anchor.blockId,
      selectedText: anchor.selectedText,
      followUp
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('chat.message.anchor.panel.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">{t('chat.message.anchor.panel.from')}</div>
            <blockquote className="border-l-2 pl-3 text-sm italic" data-testid="branch-panel-selected-text">
              {anchor?.selectedText ?? ''}
            </blockquote>
          </div>

          <div className="space-y-1 font-mono text-xs text-muted-foreground">
            <div data-testid="branch-panel-message-id">messageId: {anchor?.messageId ?? ''}</div>
            <div data-testid="branch-panel-block-id">blockId: {anchor?.blockId ?? ''}</div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="branch-panel-follow-up">
              {t('chat.message.anchor.panel.follow_up_label')}
            </label>
            <Textarea.Input
              id="branch-panel-follow-up"
              value={followUp}
              onValueChange={setFollowUp}
              placeholder={t('chat.message.anchor.panel.follow_up_placeholder')}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreateBranch} disabled={!anchor}>
            {t('chat.message.anchor.panel.create_branch')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default BranchPanel
