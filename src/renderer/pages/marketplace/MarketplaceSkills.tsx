import { Check, Loader2, Plus } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@cherrystudio/ui'
import type { MarketplaceSkill } from '@shared/types/skillMarketplace'
import { localizeMarketplaceText } from '@shared/utils/cherrySkillMarketplace'

import { MarketplaceCard, MarketplaceCardAction, MarketplaceGrid, MarketplaceLoadState } from './MarketplaceComponents'
import { MARKETPLACE_CATEGORY_KEYS } from './marketplaceLabels'
import { MarketplaceSkillDialog } from './MarketplaceSkillDialog'
import { MarketplaceSkillIcon } from './MarketplaceSkillIcon'
import type { useMarketplace } from './useMarketplace'

export function MarketplaceSkills({
  market,
  query,
  preview = false,
  active
}: {
  market: ReturnType<typeof useMarketplace>
  query: string
  preview?: boolean
  active: boolean
}) {
  const { t, i18n } = useTranslation()
  const { catalog, installed, installedCount, installedMembers, mutating, failures, mutateSkill, skipped } = market
  const [selected, setSelected] = useState<MarketplaceSkill | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [uninstallTarget, setUninstallTarget] = useState<MarketplaceSkill | null>(null)
  useLayoutEffect(
    () => () => {
      setDetailOpen(false)
      setSelected(null)
      setUninstallTarget(null)
    },
    []
  )
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return (catalog.data ?? [])
      .filter((skill) =>
        [skill.name.en, skill.name.zh, skill.description.en, skill.description.zh, skill.author, ...skill.tags]
          .join(' ')
          .toLocaleLowerCase()
          .includes(search)
      )
      .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
  }, [catalog.data, query])
  const groups = useMemo<[string, MarketplaceSkill[]][]>(() => {
    if (preview) return [['', filtered.slice(0, 6)]]
    const grouped = new Map<string, MarketplaceSkill[]>()
    for (const skill of filtered) {
      const group = grouped.get(skill.domain) ?? []
      group.push(skill)
      grouped.set(skill.domain, group)
    }
    return [...grouped]
  }, [filtered, preview])
  const installedUnavailable = installed.loading || Boolean(installed.error)
  const uninstallBusy = uninstallTarget ? mutating.has(uninstallTarget.id) : false

  return (
    <>
      <MarketplaceLoadState
        loading={catalog.isLoading}
        error={catalog.error}
        empty={!filtered.length}
        retry={() => catalog.mutate().catch(() => {})}
      />
      {installed.error ? (
        <MarketplaceLoadState error={installed.error} empty={false} retry={() => installed.refresh().catch(() => {})} />
      ) : null}
      {skipped > 0 ? (
        <p role="status" className="mb-3 text-xs text-muted-foreground">
          {t('marketplace.subscription.skipped', { count: skipped })}
        </p>
      ) : null}
      {groups.map(([domain, skills]) => (
        <section key={domain} className="mb-7">
          {domain ? (
            <h2 className="mb-3 text-sm font-medium">
              {MARKETPLACE_CATEGORY_KEYS[domain] ? t(MARKETPLACE_CATEGORY_KEYS[domain]) : domain}
            </h2>
          ) : null}
          <MarketplaceGrid
            items={skills}
            renderItem={(skill) => {
              const count = installedCount(skill)
              const complete = skill.members.length > 0 && count === skill.members.length
              const busy = mutating.has(skill.id)
              const name = localizeMarketplaceText(skill.name, i18n.language)
              return (
                <MarketplaceCard
                  name={name}
                  description={localizeMarketplaceText(skill.description, i18n.language)}
                  icon={<MarketplaceSkillIcon skill={skill} />}
                  onOpen={(event) => {
                    triggerRef.current = event.currentTarget
                    setSelected(skill)
                    setDetailOpen(true)
                  }}
                  action={
                    <MarketplaceCardAction
                      className={complete ? 'hover:bg-destructive/10 hover:text-destructive' : undefined}
                      aria-label={t(complete ? 'library.action.uninstall' : 'settings.skills.install') + ': ' + name}
                      title={t(complete ? 'library.action.uninstall' : 'settings.skills.install')}
                      disabled={busy || installedUnavailable || (!complete && !skill.hasPackage)}
                      aria-busy={busy}
                      onClick={() => {
                        if (complete) setUninstallTarget(skill)
                        else void mutateSkill(skill, 'install')
                      }}>
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : complete ? (
                        <Check className="size-4" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                    </MarketplaceCardAction>
                  }>
                  {count > 0 && !complete ? (
                    <span className="text-xs text-foreground-tertiary">
                      {t('marketplace.partial_install', {
                        installed: count,
                        total: skill.membersKnown ? skill.members.length : '—'
                      })}
                    </span>
                  ) : null}
                </MarketplaceCard>
              )
            }}
          />
        </section>
      ))}
      <MarketplaceSkillDialog
        skill={catalog.data?.find((item) => item.id === selected?.id) ?? selected}
        open={detailOpen && active}
        onOpenChange={setDetailOpen}
        onReturnFocus={() => triggerRef.current?.focus()}
        installedCount={selected ? installedCount(selected) : 0}
        installing={selected ? mutating.has(selected.id) : false}
        installedLoading={installedUnavailable}
        failures={selected ? (failures[selected.id] ?? []) : []}
        onInstall={(skill) => void mutateSkill(skill, 'install')}
      />
      <ConfirmDialog
        open={Boolean(uninstallTarget) && active}
        onOpenChange={(open) => {
          if (!open && !uninstallBusy) setUninstallTarget(null)
        }}
        title={t('library.delete.skill.title')}
        description={t('marketplace.uninstall_confirm')}
        content={
          uninstallTarget ? (
            <div className="max-h-60 space-y-3 overflow-y-auto text-sm">
              <p className="font-medium">{localizeMarketplaceText(uninstallTarget.name, i18n.language)}</p>
              {uninstallTarget.isCollection ? (
                <div className="text-muted-foreground">
                  <p>{t('marketplace.included_skills', { total: installedCount(uninstallTarget) })}</p>
                  <ul className="mt-1 list-inside list-disc">
                    {installedMembers(uninstallTarget).map((member) => (
                      <li key={member.skillId}>{member.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(failures[uninstallTarget.id] ?? []).map((failure) => (
                <p key={failure.path} role="alert" className="break-words text-error">
                  {failure.name}: {failure.error}
                </p>
              ))}
            </div>
          ) : null
        }
        confirmText={t('library.action.uninstall')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={uninstallBusy}
        confirmDisabled={installedUnavailable}
        cancelDisabled={uninstallBusy}
        onConfirm={() => (uninstallTarget ? mutateSkill(uninstallTarget, 'uninstall') : false)}
      />
    </>
  )
}
