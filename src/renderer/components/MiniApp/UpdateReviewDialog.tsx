import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { UpdateReviewCard } from '@renderer/components/MiniApp/UpdateReviewCard'
import type { UpdateDecision, UpdateOffer } from '@renderer/hooks/useMiniAppUpdate'

/**
 * The one place an available update is reviewed and applied — reached from the tile's
 * menu, the panel's "new version" chip and its "check for updates" button alike. Cancel
 * leaves the app as it is; the token simply expires.
 */
export const UpdateReviewDialog: FC<{
  name: string
  update: UpdateOffer
  busy: boolean
  onCancel: () => void
  onApply: (decision: UpdateDecision) => void
}> = ({ name, update, busy, onCancel, onApply }) => {
  const { t } = useTranslation()
  // Offered optional leaves start on; only the exceptions are tracked.
  const [declined, setDeclined] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string, on: boolean) =>
    setDeclined((prev) => {
      const next = new Set(prev)
      if (on) next.delete(key)
      else next.add(key)
      return next
    })
  const needsConsent = update.status === 'needs-consent'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}>
      <DialogContent
        closeOnOverlayClick={false}
        aria-describedby={undefined}
        className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-md">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate">
            {t('miniApp.detail.update_available', { version: update.version })}
          </DialogTitle>
          <p className="truncate text-muted-foreground text-sm">{name}</p>
        </DialogHeader>
        <div data-testid="update-consent" className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto py-2">
          <UpdateReviewCard update={update} declined={declined} onToggle={toggle} />
          {/* The one thing the user cannot see coming: the swap closes a running instance. */}
          <p className="text-muted-foreground text-xs">{t('miniApp.detail.update_closes_running')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            onClick={() =>
              onApply({
                consented: needsConsent,
                grantedOptional: update.addedOptional.filter((leaf) => !declined.has(leaf))
              })
            }>
            {needsConsent
              ? t('miniApp.detail.update_accept')
              : t('miniApp.detail.update_apply', { version: update.version })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
