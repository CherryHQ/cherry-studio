import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'

export function AccountSignOutButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { status, revokeSession, isRevokingSession } = useCherryAccountSession()
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (status?.phase !== 'signed-in') return null

  return (
    <div className={cn('border-border-subtle border-t pt-4', className)}>
      <Button variant="outline" size="sm" loading={isRevokingSession} onClick={() => setConfirmOpen(true)}>
        {!isRevokingSession ? <LogOut className="size-4 text-muted-foreground" aria-hidden /> : null}
        {t('settings.provider.cherry_cloud.logout')}
      </Button>
      <ConfirmDialog
        contentClassName="gap-3 p-4 sm:max-w-sm"
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          <span className="wrap-anywhere leading-snug">
            {status.displayName
              ? t('settings.provider.cherry_cloud.logout_confirm_account', { displayName: status.displayName })
              : t('settings.provider.cherry_cloud.logout_confirm_title')}
          </span>
        }
        description={
          <span className="text-foreground">{t('settings.provider.cherry_cloud.logout_confirm_description')}</span>
        }
        cancelText={t('common.cancel')}
        confirmText={t('settings.provider.cherry_cloud.logout')}
        confirmLoading={isRevokingSession}
        destructive
        onConfirm={revokeSession}
      />
    </div>
  )
}
