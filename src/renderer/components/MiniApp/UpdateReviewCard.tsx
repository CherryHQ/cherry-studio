import { CheckCircle2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { PermissionChecklist } from '@renderer/components/MiniApp/PermissionChecklist'
import type { UpdateOffer } from '@renderer/hooks/useMiniAppUpdate'
import { type LocalizedText, resolveLocalizedText } from '@shared/types/miniAppManifest'

/**
 * Main flags a rename when ANY locale differs; read in a locale that did not change, the
 * old and new names are the same string and the change would vanish. Fall back to the
 * locale that actually moved, and say which.
 */
function describeRename(name: { from: LocalizedText; to: LocalizedText }, language: string) {
  const from = resolveLocalizedText(name.from, language)
  const to = resolveLocalizedText(name.to, language)
  if (from !== to) return { from, to }
  const tableOf = (text: LocalizedText): Record<string, string | undefined> =>
    typeof text === 'string' ? { en: text } : text
  const before = tableOf(name.from)
  const after = tableOf(name.to)
  const locale = [...new Set([...Object.keys(before), ...Object.keys(after)])].find((l) => before[l] !== after[l])
  return locale ? { from: before[locale] ?? '', to: after[locale] ?? '', locale } : { from, to }
}

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
  const unchanged =
    added.length === 0 && addedHosts.length === 0 && update.addedOptional.length === 0 && update.removed.length === 0
  const rename = update.identityChange?.name && describeRename(update.identityChange.name, language)
  return (
    <div className="flex flex-col gap-2">
      {/* Said out loud: an empty diff must read as "nothing changed", never as "nothing loaded". */}
      {unchanged && (
        <p className="flex items-center gap-1.5 text-sm text-success-subtle-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-success" />
          {t('miniApp.detail.update_unchanged')}
        </p>
      )}
      {rename && (
        <p className="text-sm text-warning-subtle-foreground">
          {t(rename.locale ? 'miniApp.detail.update_rename_locale' : 'miniApp.detail.update_rename', rename)}
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
      {update.removed.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{t('miniApp.detail.update_removed')}</span>
          <PermissionChecklist
            items={update.removed.map((key) => ({ key, checked: false, fixed: true }))}
            onToggle={() => undefined}
          />
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
