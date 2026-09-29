import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  BookOpen,
  Bot,
  Check,
  FileText,
  FolderHeart,
  Layers,
  Loader2,
  Network,
  Plug,
  Plus,
  Sparkles,
  WandSparkles
} from 'lucide-react'
import { Activity, lazy, Suspense, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog, EmptyState, Spinner } from '@cherrystudio/ui'
import { ResourceCatalogSearchInput } from '@renderer/components/resourceCatalog/ResourceCatalogSearchInput'
import { toast } from '@renderer/services/toast'
import type { MarketplaceSkill } from '@shared/types/skillMarketplace'
import { localizeMarketplaceText } from '@shared/utils/cherrySkillMarketplace'

import { MARKETPLACE_CATEGORY_KEYS } from './marketplaceLabels'
import { MarketplaceSkillDialog } from './MarketplaceSkillDialog'
import { MarketplaceSkillIcon } from './MarketplaceSkillIcon'
import { useMarketplace } from './useMarketplace'

const MyResourcesPage = lazy(() => import('./MyResourcesPage'))

const RESOURCE_TYPES = [
  { id: 'all', label: 'common.all', icon: Layers },
  { id: 'skill', label: 'marketplace.type.skill', icon: Sparkles },
  { id: 'mcp', label: 'marketplace.type.mcp', icon: Network },
  { id: 'agent', label: 'marketplace.type.agent', icon: Bot },
  { id: 'assistant', label: 'marketplace.type.assistant', icon: WandSparkles },
  { id: 'prompt', label: 'marketplace.type.prompt', icon: FileText },
  { id: 'knowledge', label: 'title.knowledge', icon: BookOpen },
  { id: 'connector', label: 'marketplace.type.connector', icon: Plug }
]

export default function MarketplacePage() {
  const { t } = useTranslation()
  const { view } = useSearch({ from: '/app/marketplace' })
  const navigate = useNavigate({ from: '/app/marketplace' })
  return (
    <>
      <Activity mode={view === 'mine' ? 'hidden' : 'visible'}>
        <MarketplaceCatalog onOpenMine={() => void navigate({ search: { view: 'mine' } })} />
      </Activity>
      <Activity mode={view === 'mine' ? 'visible' : 'hidden'}>
        <Suspense fallback={<Spinner text={t('common.loading')} />}>
          <MyResourcesPage onBrowseTemplates={() => void navigate({ search: {} })} />
        </Suspense>
      </Activity>
    </>
  )
}

function MarketplaceCatalog({ onOpenMine }: { onOpenMine: () => void }) {
  const { t, i18n } = useTranslation()
  const { catalog, installed, installedCount, installedMembers, mutating, failures, mutateSkill } = useMarketplace()
  const [query, setQuery] = useState('')
  const [resourceType, setResourceType] = useState('all')
  const [selected, setSelected] = useState<MarketplaceSkill | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [uninstallTarget, setUninstallTarget] = useState<MarketplaceSkill | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const groups = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    const grouped = new Map<string, MarketplaceSkill[]>()
    for (const skill of catalog.data ?? []) {
      const content = [
        skill.name.en,
        skill.name.zh,
        skill.description.en,
        skill.description.zh,
        skill.author,
        ...skill.tags
      ]
        .join(' ')
        .toLocaleLowerCase()
      if (search && !content.includes(search)) continue
      const group = grouped.get(skill.domain) ?? []
      group.push(skill)
      grouped.set(skill.domain, group)
    }
    for (const skills of grouped.values()) skills.sort((a, b) => b.downloads - a.downloads)
    return [...grouped]
  }, [catalog.data, query])
  const installedUnavailable = installed.loading || Boolean(installed.error)
  const uninstallBusy = uninstallTarget ? mutating.has(uninstallTarget.id) : false

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="marketplace-page">
      <header className="flex h-16 shrink-0 items-center justify-end gap-2 px-6">
        <Button variant="outline" size="sm" onClick={onOpenMine}>
          <FolderHeart className="size-3.5" />
          {t('marketplace.mine')}
        </Button>
        <Button variant="outline" size="sm" disabled>
          <Plus className="size-3.5" />
          {t('marketplace.submit')}
        </Button>
      </header>
      <div className="flex min-h-0 w-full flex-1 gap-6 px-6 pb-6">
        <aside className="w-36 shrink-0 pt-4 lg:w-44" aria-label={t('marketplace.resource_types')}>
          <h2 className="mb-3 px-3 text-xs text-foreground-tertiary">{t('marketplace.resource_types')}</h2>
          <nav className="space-y-1">
            {RESOURCE_TYPES.map(({ id, label, icon: Icon }) => {
              const available = id === 'all' || id === 'skill'
              return (
                <Button
                  key={id}
                  variant="ghost"
                  disabled={!available}
                  aria-pressed={id === resourceType}
                  onClick={() => setResourceType(id)}
                  className={`h-9 w-full justify-start rounded-xl px-3 text-sm ${id === resourceType ? 'bg-accent' : 'text-muted-foreground'}`}>
                  <Icon className="size-4" strokeWidth={1.5} />
                  <span>{t(label)}</span>
                  <span className="ml-auto text-xs font-normal text-foreground-tertiary">
                    {available ? (catalog.data?.length ?? '—') : '—'}
                  </span>
                </Button>
              )
            })}
          </nav>
        </aside>

        <main className="@container flex min-h-0 min-w-0 flex-1 flex-col pt-3">
          <ResourceCatalogSearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('marketplace.search_placeholder')}
            aria-label={t('marketplace.search_placeholder')}
            className="shrink-0 [&_input]:h-10 [&_input]:rounded-xl"
          />
          <div className="py-3">
            <span className="inline-flex rounded-full bg-[#feafaf] px-3 py-1.5 text-xs font-medium text-white">
              {t('marketplace.curated')}
            </span>
          </div>
          {catalog.error ? (
            <div role="alert" className="mb-3 flex items-center justify-between gap-3 text-sm text-error">
              {t('marketplace.load_failed')}
              <Button variant="outline" size="sm" onClick={() => void catalog.mutate()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : null}
          {installed.error ? (
            <div role="alert" className="mb-3 flex items-center justify-between gap-3 text-sm text-error">
              {t('marketplace.installed_load_failed')}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void installed.refresh().catch(() => toast.error(t('common.error')))}>
                {t('common.retry')}
              </Button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto pr-1" aria-busy={catalog.isLoading}>
            {catalog.isLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Spinner text={t('common.loading')} />
              </div>
            ) : !groups.length && !catalog.error ? (
              <EmptyState
                preset="no-result"
                title={t('marketplace.no_results')}
                description={t('marketplace.no_results_description')}
              />
            ) : (
              groups.map(([domain, skills]) => (
                <section key={domain} className="mb-7">
                  <h2 className="mb-3 text-sm font-medium">
                    {MARKETPLACE_CATEGORY_KEYS[domain] ? t(MARKETPLACE_CATEGORY_KEYS[domain]) : domain}
                  </h2>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 @[720px]:grid-cols-2">
                    {skills.map((skill) => {
                      const count = installedCount(skill)
                      const complete = skill.members.length > 0 && count === skill.members.length
                      const busy = mutating.has(skill.id)
                      const name = localizeMarketplaceText(skill.name, i18n.language)
                      return (
                        <div
                          key={skill.id}
                          className="flex min-w-0 items-center gap-2 rounded-2xl border border-border-subtle pr-3 transition-colors hover:bg-accent/50">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-2xl p-3 text-left"
                            onClick={(event) => {
                              triggerRef.current = event.currentTarget
                              setSelected(skill)
                              setDetailOpen(true)
                            }}>
                            <MarketplaceSkillIcon skill={skill} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium" title={name}>
                                {name}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {localizeMarketplaceText(skill.description, i18n.language)}
                              </p>
                              {count > 0 && !complete ? (
                                <span className="text-xs text-foreground-tertiary">
                                  {t('marketplace.partial_install', {
                                    installed: count,
                                    total: skill.membersKnown ? skill.members.length : '—'
                                  })}
                                </span>
                              ) : null}
                            </div>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className={`size-7 shrink-0 rounded-full bg-background-subtle text-muted-foreground dark:text-muted-foreground ${complete ? 'hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive dark:hover:text-destructive dark:focus-visible:text-destructive' : ''}`}
                            aria-label={`${t(complete ? 'library.action.uninstall' : 'settings.skills.install')}: ${name}`}
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
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </main>
      </div>
      <MarketplaceSkillDialog
        skill={catalog.data?.find((item) => item.id === selected?.id) ?? selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onReturnFocus={() => triggerRef.current?.focus()}
        installedCount={selected ? installedCount(selected) : 0}
        installing={selected ? mutating.has(selected.id) : false}
        installedLoading={installedUnavailable}
        failures={selected ? (failures[selected.id] ?? []) : []}
        onInstall={(skill) => void mutateSkill(skill, 'install')}
      />
      <ConfirmDialog
        open={Boolean(uninstallTarget)}
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
    </div>
  )
}
