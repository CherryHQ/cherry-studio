import { Check, Download, ExternalLink, Loader2, Package, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSWR, { useSWRConfig } from 'swr'

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { MarketplaceInstallResult, MarketplaceSkill } from '@shared/types/skillMarketplace'
import { localizeMarketplaceText } from '@shared/utils/cherrySkillMarketplace'

import { MARKETPLACE_CATEGORY_KEYS } from './marketplaceLabels'
import { MarketplaceSkillIcon } from './MarketplaceSkillIcon'

type Props = {
  skill: MarketplaceSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onReturnFocus: () => void
  installedCount: number
  installing: boolean
  installedLoading: boolean
  failures: MarketplaceInstallResult['failed']
  onInstall: (skill: MarketplaceSkill) => void
}

export function MarketplaceSkillDialog({
  skill,
  open,
  onOpenChange,
  onReturnFocus,
  installedCount,
  installing,
  installedLoading,
  failures,
  onInstall
}: Props) {
  const { t, i18n } = useTranslation()
  const { mutate: mutateCache } = useSWRConfig()
  const {
    data: detail,
    error,
    isLoading,
    mutate
  } = useSWR(
    open && skill ? ['skill.marketplace.detail', skill.id] : null,
    ([, id]) => ipcApi.request('skill.marketplace.detail', { id }),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      onSuccess: ({ id, members, membersKnown, isCollection }) => {
        void mutateCache<MarketplaceSkill[]>(
          'skill.marketplace.list',
          (items) => items?.map((item) => (item.id === id ? { ...item, members, membersKnown, isCollection } : item)),
          { revalidate: false }
        )
      }
    }
  )
  if (!skill) return null
  const item = detail ?? skill
  const text = (value: { en: string; zh: string | null }) => localizeMarketplaceText(value, i18n.language)
  const installed = item.members.length > 0 && installedCount === item.members.length
  const source = item.githubRepoUrl || item.sourceUrl
  const validSource = source && /^https?:\/\//i.test(source) ? source : null
  const date = new Date(item.releaseDate)
  const published = Number.isNaN(date.getTime())
    ? item.releaseDate
    : new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' }).format(date)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="default"
        motion="fade-scale"
        closeLabel={t('common.close')}
        overlayClassName="backdrop-blur-sm"
        className="flex max-h-[calc(100vh-3rem)] flex-col gap-0 overflow-hidden rounded-3xl p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onReturnFocus()
        }}>
        <DialogDescription className="sr-only">{text(item.description)}</DialogDescription>
        <DialogHeader className="shrink-0 border-border-subtle border-b bg-background-subtle px-5 pt-10 pb-5 text-left">
          <div className="flex items-center gap-3">
            <MarketplaceSkillIcon skill={item} large />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <DialogTitle className="truncate">{text(item.name)}</DialogTitle>
                <Badge variant="secondary">{t('marketplace.type.skill')}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.author ? `@${item.author} · ` : ''}
                {published}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-3 gap-2">
            {[
              [
                t('marketplace.downloads'),
                new Intl.NumberFormat(i18n.resolvedLanguage, { notation: 'compact' }).format(item.downloads)
              ],
              [t('marketplace.version'), item.version || '—'],
              [
                t('marketplace.category'),
                MARKETPLACE_CATEGORY_KEYS[item.domain] ? t(MARKETPLACE_CATEGORY_KEYS[item.domain]) : item.domain
              ]
            ].map(([label, value]) => (
              <div
                key={label}
                className="min-w-0 rounded-xl border border-border-subtle bg-background-subtle px-3 py-2">
                <div className="text-xs text-foreground-tertiary">{label}</div>
                <div className="mt-1 truncate text-sm font-medium" title={value}>
                  {value}
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {text(detail?.longDescription ?? item.description) || text(item.description)}
          </p>
          {isLoading ? <Spinner text={t('common.loading')} /> : null}
          {error ? (
            <div role="alert" className="flex items-center justify-between gap-3 text-sm text-error">
              {t('marketplace.load_failed')}
              <Button variant="outline" size="sm" onClick={() => void mutate()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : null}

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-xs font-medium">
              <Package className="size-3.5 text-foreground-tertiary" />
              {t('marketplace.included_skills', { total: item.membersKnown ? item.members.length : '—' })}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {item.members.map((member) => (
                <div
                  key={member.path}
                  className="flex min-w-0 items-start gap-2 rounded-xl border border-border-subtle bg-background-subtle p-3">
                  <Sparkles className="mt-0.5 size-3 shrink-0 text-foreground-tertiary" />
                  <span className="break-words text-xs leading-5">{member.name}</span>
                </div>
              ))}
            </div>
          </section>

          {installed ? (
            <div
              role="status"
              className="flex gap-2 rounded-xl border border-success-border bg-success-subtle p-3 text-xs leading-5 text-success-subtle-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0" />
              {t('marketplace.installed_hint')}
            </div>
          ) : installedCount > 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('marketplace.partial_install', {
                installed: installedCount,
                total: item.membersKnown ? item.members.length : '—'
              })}
            </p>
          ) : null}
          {failures.length ? (
            <ul
              role="alert"
              className="space-y-1 rounded-xl border border-error-border bg-error-subtle p-3 text-xs text-error-subtle-foreground">
              {failures.map((failure) => (
                <li key={failure.path} className="break-words">
                  {failure.name}: {failure.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-border-subtle border-t bg-background-subtle px-5 py-3">
          {validSource ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(validSource)}
              className="text-xs text-muted-foreground">
              <ExternalLink className="size-3.5" />
              {t(item.githubRepoUrl ? 'marketplace.view_repository' : 'marketplace.view_source')}
            </Button>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            variant={installed ? 'outline' : 'default'}
            disabled={installed || installing || installedLoading || !item.hasPackage}
            aria-busy={installing}
            onClick={() => onInstall(item)}>
            {installing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : installed ? (
              <Check className="size-4" />
            ) : (
              <Download className="size-4" />
            )}
            {t(
              installed
                ? 'settings.skills.installed'
                : !item.hasPackage
                  ? 'marketplace.unavailable'
                  : installing
                    ? 'common.loading'
                    : installedCount
                      ? 'marketplace.install_remaining'
                      : 'marketplace.install_now'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
