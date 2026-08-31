import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { PermissionChecklist } from '@renderer/components/MiniApp/PermissionChecklist'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Leaves a Cherry release added under a namespace the app declared (decision A): the
 * host asks, never grants by itself. "Not now" silences the dot for this launch and
 * keeps the offer in the panel; "Grant" answers it for good.
 */
export const PendingPermissionsDialog: FC<{
  name: string
  leaves: readonly string[]
  busy: boolean
  onGrant: () => void
  onSnooze: () => void
  onCancel: () => void
}> = ({ name, leaves, busy, onGrant, onSnooze, onCancel }) => {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}>
      <DialogContent closeOnOverlayClick={false} aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate">{t('miniApp.detail.pending_title')}</DialogTitle>
          <p className="truncate text-muted-foreground text-sm">{name}</p>
        </DialogHeader>
        <div data-testid="pending-permissions" className="flex min-w-0 flex-col gap-3 py-2">
          <p className="text-sm">{t('miniApp.detail.pending_hint')}</p>
          <PermissionChecklist
            items={leaves.map((key) => ({ key, checked: true, fixed: true }))}
            onToggle={() => undefined}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onSnooze} disabled={busy}>
            {t('miniApp.detail.pending_snooze')}
          </Button>
          <Button loading={busy} onClick={onGrant}>
            {t('miniApp.detail.grant_pending')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
