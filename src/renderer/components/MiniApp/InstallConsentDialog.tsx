import { Package } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tooltip
} from '@cherrystudio/ui'
import { PermissionChecklist } from '@renderer/components/MiniApp/PermissionChecklist'
import { UpdateReviewCard } from '@renderer/components/MiniApp/UpdateReviewCard'
import type { InstallDecision, InstallPreview } from '@renderer/hooks/useMiniAppInstallPreview'
import { resolveLocalizedText } from '@shared/types/miniAppManifest'

/**
 * The consent card in its own dialog, on top of whatever asked for it. Three shapes of
 * one card, decided by main from the version: a fresh install, a reinstall over the
 * same or an older version (with the "delete existing data" question), or an upgrade
 * (the update review). Cancel withdraws the consent and returns to the host.
 */
export const InstallConsentDialog: FC<{
  preview: InstallPreview
  busy: boolean
  onCancel: () => void
  onConfirm: (decision: InstallDecision) => void
}> = ({ preview, busy, onCancel, onConfirm }) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const name = resolveLocalizedText(preview.manifest.name, language)
  // Optional leaves are on unless unticked — tracking the exceptions keeps "all on" the default.
  const [declined, setDeclined] = useState<ReadonlySet<string>>(new Set())
  const toggleOptional = (leaf: string, on: boolean) =>
    setDeclined((prev) => {
      const next = new Set(prev)
      if (on) next.delete(leaf)
      else next.add(leaf)
      return next
    })
  const installed = preview.installed
  const relation = preview.kind === 'upgrade' ? 'upgrade' : preview.installed?.relation
  // A downgrade starts with the wipe ON: data the newer version wrote is the likelier hazard.
  const [clearData, setClearData] = useState(relation === 'downgrade')
  const sourceLabel = {
    file: t('miniApp.install.source_file'),
    url: t('miniApp.install.source_url'),
    builtin: t('miniApp.install.source_builtin')
  }

  const title =
    preview.kind === 'upgrade'
      ? t('miniApp.install.upgrade_title')
      : installed
        ? t('miniApp.install.reinstall_title')
        : t('miniApp.install.title')

  const confirm = () => {
    if (preview.kind === 'upgrade') {
      onConfirm({
        grantedOptional: preview.update.addedOptional.filter((leaf) => !declined.has(leaf)),
        consented: preview.update.status === 'needs-consent'
      })
      return
    }
    onConfirm({ grantedOptional: preview.optional.filter((leaf) => !declined.has(leaf)), clearData })
  }

  const confirmLabel =
    preview.kind === 'upgrade'
      ? preview.update.status === 'needs-consent'
        ? t('miniApp.detail.update_accept')
        : t('miniApp.detail.update_apply', { version: preview.update.version })
      : installed
        ? t('miniApp.install.reinstall')
        : t('miniApp.install.confirm')

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}>
      <DialogContent
        closeOnOverlayClick={false}
        aria-describedby={undefined}
        // Header / body / footer as grid rows: only the body scrolls, and `minmax(0,1fr)` is what lets it —
        // a grid row defaults to min-height:auto and would never shrink below its content. No `overflow`
        // here: tooltips portal into this element, and a clipping box would cut them at the edge.
        className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* `min-w-0`: a grid item defaults to min-content width, and an unbreakable id would widen the whole dialog. */}
        <div data-testid="install-preview" className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto py-2">
          <div className="flex items-center gap-3">
            {preview.iconDataUrl ? (
              <img src={preview.iconDataUrl} alt="" className="size-12 shrink-0 rounded-lg" />
            ) : (
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Package size={24} />
              </div>
            )}
            {/* Both lines truncate; hover shows the whole thing — a 64-char name or a 120-char id is legal. */}
            <div className="min-w-0">
              <Tooltip content={name} fullWidthTrigger>
                <div className="truncate font-semibold text-base">{name}</div>
              </Tooltip>
              <Tooltip content={preview.manifest.id} fullWidthTrigger>
                <div className="truncate text-muted-foreground text-xs">
                  {t('miniApp.install.version', { version: preview.manifest.version })} · {preview.manifest.id}
                </div>
              </Tooltip>
            </div>
          </div>
          {/* Right under the identity, in warning colours: "already installed" is the first thing to know. */}
          {installed && (
            <div
              data-testid="installed-notice"
              className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-subtle p-3 text-sm text-warning-subtle-foreground">
              <p>
                {relation === 'upgrade' &&
                  t('miniApp.install.installed_upgrade', {
                    installed: installed.version,
                    version: preview.manifest.version
                  })}
                {relation === 'same' && t('miniApp.install.installed_same', { version: installed.version })}
                {relation === 'downgrade' &&
                  t('miniApp.install.installed_downgrade', {
                    installed: installed.version,
                    version: preview.manifest.version
                  })}
              </p>
              {installed.source !== preview.source && (
                <p className="text-xs">
                  {t('miniApp.install.source_change', {
                    from: sourceLabel[installed.source],
                    to: sourceLabel[preview.source]
                  })}
                </p>
              )}
            </div>
          )}
          {/* The description precedes the permissions: it is the reason the user judges them by.
              Five lines, then its own scrollbar — never the dialog's. */}
          {/* `shrink-0`: inside the scrolling column an overflow item has min-height 0 and would be squeezed away. */}
          <p className="max-h-[5lh] shrink-0 overflow-y-auto text-sm">
            {resolveLocalizedText(preview.manifest.description, language)}
          </p>

          {preview.kind === 'upgrade' ? (
            <UpdateReviewCard update={preview.update} declined={declined} onToggle={toggleOptional} />
          ) : (
            <section className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <h3 className="font-medium text-sm">{t('miniApp.install.permissions_title')}</h3>
                <p className="text-muted-foreground text-xs">{t('miniApp.install.permissions_hint')}</p>
              </div>
              {/* One list, Android-style: required leaves are ticked and fixed, optional ones the user's to untick. */}
              <PermissionChecklist
                testId="permissions"
                emptyText={t('miniApp.install.none')}
                items={[
                  ...preview.required.map((key) => ({ key, checked: true, fixed: true })),
                  ...preview.optional.map((key) => ({ key, checked: !declined.has(key), fixed: false }))
                ]}
                hosts={preview.manifest.network}
                onToggle={toggleOptional}
              />
            </section>
          )}
        </div>

        <DialogFooter>
          {/* The one question a reinstall asks lives beside its answer button, never scrolled away;
              `justify-center` because the footer stretches it to button height. */}
          {preview.kind === 'install' && installed && (
            <div className="flex min-w-0 flex-col justify-center gap-1 sm:mr-auto">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  size="sm"
                  checked={clearData}
                  disabled={busy}
                  aria-label={t('miniApp.install.clear_data')}
                  onCheckedChange={(checked) => setClearData(checked === true)}
                />
                <span>{t('miniApp.install.clear_data')}</span>
              </label>
              {relation === 'downgrade' && !clearData && (
                <p className="text-warning-subtle-foreground text-xs">
                  {t('miniApp.install.downgrade_keep_data_warning', { installed: installed.version })}
                </p>
              )}
            </div>
          )}
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={confirm} loading={busy}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
