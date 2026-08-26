import { PermissionChecklist } from '@renderer/components/MiniApp/PermissionChecklist'
import type { OutputFor } from '@shared/ipc/types'
import { resolveLocalizedText } from '@shared/types/miniAppManifest'
import { CheckCircle2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

/** An update that carries a token — the two shapes the card can render. */
export type UpdateOffer = Exclude<OutputFor<'mini_app.update.check'>, { status: 'current' }>

/**
 * What an update changes, for the user to read before applying: identity, the required
 * leaves and hosts that need consent, the optional leaves on offer, the author's notes.
 * Identity changes sit BESIDE the permission changes: a rename plus a notification grant
 * is the in-product phishing shape. Title and buttons belong to the host.
 */
export const UpdateReviewCard: FC<{
  update: UpdateOffer
  /** Offered optional leaves the user unticked — "all on" is the default, so only the exceptions are tracked. */
  declined: ReadonlySet<string>
  onToggle: (key: string, on: boolean) => void
}> = ({ update, declined, onToggle }) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const added = update.status === 'needs-consent' ? update.added : []
  const addedHosts = update.status === 'needs-consent' ? update.addedHosts : []
  const unchanged = added.length === 0 && addedHosts.length === 0 && update.addedOptional.length === 0
  return (
    <div className="flex flex-col gap-2">
      {/* Said out loud: an empty diff must read as "nothing changed", never as "nothing loaded". */}
      {unchanged && (
        <p className="flex items-center gap-1.5 text-sm text-success-subtle-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-success" />
          {t('miniApp.detail.update_unchanged')}
        </p>
      )}
      {update.identityChange?.name && (
        <p className="text-sm text-warning-subtle-foreground">
          {t('miniApp.detail.update_rename', {
            from: resolveLocalizedText(update.identityChange.name.from, language),
            to: resolveLocalizedText(update.identityChange.name.to, language)
          })}
        </p>
      )}
      {update.identityChange?.icon && (
        <p className="text-sm text-warning-subtle-foreground">{t('miniApp.detail.update_icon')}</p>
      )}
      {added.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{t('miniApp.detail.update_added')}</span>
          <PermissionChecklist
            items={added.map((key) => ({ key, checked: true, fixed: true }))}
            onToggle={() => undefined}
          />
        </div>
      )}
      {addedHosts.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{t('miniApp.detail.update_added_hosts')}</span>
          <ul className="font-mono text-sm">
            {addedHosts.map((host) => (
              <li key={host}>{host}</li>
            ))}
          </ul>
        </div>
      )}
      {update.addedOptional.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{t('miniApp.detail.update_added_optional')}</span>
          <PermissionChecklist
            items={update.addedOptional.map((key) => ({ key, checked: !declined.has(key), fixed: false }))}
            onToggle={onToggle}
          />
        </div>
      )}
      {/* Author-supplied prose goes BELOW the diff so it can never push the list out of view. */}
      {update.releaseNotes && (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{t('miniApp.detail.update_release_notes')}</span>
          <p className="whitespace-pre-wrap text-sm">{update.releaseNotes}</p>
        </div>
      )}
    </div>
  )
}
