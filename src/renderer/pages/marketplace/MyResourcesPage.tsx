import { Bot, ChevronDown, FileText, Import, MessageSquare, Plus, Sparkles, Store } from 'lucide-react'
import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Spinner
} from '@cherrystudio/ui'
import { ResourceCatalogSearchInput } from '@renderer/components/resourceCatalog/ResourceCatalogSearchInput'
import { useInstalledSkills, useReconcileSkillsOnOpen } from '@renderer/hooks/useSkills'
import { toast } from '@renderer/services/toast'
import type { InstalledSkill } from '@shared/types/skill'
import { localizeMarketplaceText, marketplaceSkillSource } from '@shared/utils/cherrySkillMarketplace'

import { LocalSkillDetailDialog } from './LocalSkillDetailDialog'
import { DEFAULT_LIBRARY_FILTERS, MyResourcesFilter } from './MyResourcesFilter'
import { MySkillMenu } from './MySkillMenu'
import { loadMarketplaceSkills } from './useMarketplace'
import { useSkillLibraryTags } from './useSkillLibraryTags'

const ImportSkillDialog = lazy(() =>
  import('@renderer/components/resourceCatalog/dialogs/skill').then((module) => ({
    default: module.ImportSkillDialog
  }))
)
export default function MyResourcesPage({ onBrowseTemplates }: { onBrowseTemplates: () => void }) {
  const { t, i18n } = useTranslation()
  const { data: catalog } = useSWR('skill.marketplace.list', loadMarketplaceSkills, {
    revalidateOnFocus: false,
    shouldRetryOnError: false
  })
  const { skills, loading, error, refresh } = useInstalledSkills()
  useReconcileSkillsOnOpen(true)
  const [query, setQuery] = useState('')
  const [storedFilters, setFilters] = useState(DEFAULT_LIBRARY_FILTERS)
  const tags = useSkillLibraryTags()
  const filters = useMemo(
    () => ({ ...storedFilters, tags: storedFilters.tags.filter((id) => tags.tags.some((tag) => tag.id === id)) }),
    [storedFilters, tags.tags]
  )
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<InstalledSkill | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const owned = useMemo(() => skills.filter((skill) => skill.source !== 'builtin'), [skills])
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const skill of owned) {
      for (const tag of tags.assignments[skill.id] ?? []) counts[tag] = (counts[tag] ?? 0) + 1
    }
    return counts
  }, [owned, tags.assignments])
  const marketplaceNames = useMemo(
    () => new Map(catalog?.map((skill) => [marketplaceSkillSource(skill.id, ''), skill.name])),
    [catalog]
  )
  const displayName = (skill: InstalledSkill) => {
    const name = skill.source === 'marketplace' && skill.sourceUrl ? marketplaceNames.get(skill.sourceUrl) : undefined
    return name ? localizeMarketplaceText(name, i18n.language) || skill.name : skill.name
  }
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return owned
      .filter(
        (skill) =>
          (filters.source === 'all' ||
            (filters.source === 'online' ? skill.source === 'marketplace' : skill.source !== 'marketplace')) &&
          (!filters.tags.length || filters.tags.some((id) => tags.assignments[skill.id]?.includes(id))) &&
          `${skill.name} ${skill.description ?? ''} ${marketplaceNames.get(skill.sourceUrl ?? '')?.zh ?? ''} ${marketplaceNames.get(skill.sourceUrl ?? '')?.en ?? ''}`
            .toLocaleLowerCase()
            .includes(search)
      )
      .sort((a, b) => {
        if (filters.sort !== 'name')
          return b[filters.sort].localeCompare(a[filters.sort]) || a.name.localeCompare(b.name)
        const name = (skill: InstalledSkill) => {
          const localized = marketplaceNames.get(skill.sourceUrl ?? '')
          return localized ? localizeMarketplaceText(localized, i18n.language) || skill.name : skill.name
        }
        return name(a).localeCompare(name(b), i18n.language)
      })
  }, [owned, query, filters, marketplaceNames, tags.assignments, i18n.language])

  return (
    <div className="flex h-full min-h-0 bg-background" data-testid="my-resources-page">
      <aside className="w-36 shrink-0 border-r border-border-subtle px-3 py-5 lg:w-48">
        <h1 className="px-2 text-sm font-medium">{t('library.title')}</h1>
        <p className="mt-1 px-2 text-xs text-foreground-tertiary">{t('marketplace.library_subtitle')}</p>
        <p className="mt-6 mb-2 px-2 text-xs text-foreground-tertiary">{t('marketplace.mine')}</p>
        <nav className="space-y-1" aria-label={t('marketplace.resource_types')}>
          {[
            { label: 'marketplace.type.skill', icon: Sparkles, enabled: true },
            { label: 'marketplace.type.prompt', icon: FileText },
            { label: 'library.type.assistant', icon: MessageSquare },
            { label: 'marketplace.type.agent', icon: Bot }
          ].map(({ label, icon: Icon, enabled }) => (
            <Button
              key={label}
              variant="ghost"
              disabled={!enabled}
              aria-pressed={Boolean(enabled)}
              className={`h-9 w-full justify-start rounded-xl px-2 ${enabled ? 'bg-accent' : ''}`}>
              <Icon className="size-4" strokeWidth={1.5} />
              {t(label)}
              <span className="ml-auto text-xs text-foreground-tertiary">
                {enabled ? (loading ? '—' : owned.length) : '—'}
              </span>
            </Button>
          ))}
        </nav>
      </aside>
      <main className="@container flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-5 py-3">
          <ResourceCatalogSearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('library.toolbar.search_placeholder')}
            aria-label={t('library.toolbar.search_placeholder')}
            className="min-w-40 flex-1 sm:max-w-72"
          />
          <MyResourcesFilter value={filters} onChange={setFilters} manager={tags} counts={tagCounts} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onBrowseTemplates}>
              <Store className="size-3.5" />
              {t('marketplace.browse_templates')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="rounded-full">
                  <Plus className="size-3.5" />
                  {t('marketplace.new_resource')}
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {[
                  { type: 'Prompt', icon: FileText },
                  { type: t('library.type.assistant'), icon: MessageSquare },
                  { type: t('library.type.agent'), icon: Bot }
                ].map(({ type, icon: Icon }) => (
                  <DropdownMenuItem key={type} disabled>
                    <Icon className="size-4" />
                    {t('library.create_menu.create', { type })}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                  <Import className="size-4" />
                  {t('library.import_skill_dialog.title')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5" aria-busy={loading}>
          {loading ? (
            <Spinner text={t('common.loading')} />
          ) : error ? (
            <div role="alert" className="flex items-center justify-center gap-3 text-sm text-error">
              {t('marketplace.installed_load_failed')}
              <Button
                variant="outline"
                onClick={() => void refresh().catch(() => toast.error(t('marketplace.installed_load_failed')))}>
                {t('common.retry')}
              </Button>
            </div>
          ) : !visible.length ? (
            <EmptyState
              title={t(owned.length ? 'library.empty_state.no_match_title' : 'library.empty_state.title')}
              description={t(
                owned.length
                  ? 'library.empty_state.no_match_description'
                  : 'library.skill_marketplace.no_results_description'
              )}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 @[440px]:grid-cols-2 @[680px]:grid-cols-3 @[920px]:grid-cols-4 @[1160px]:grid-cols-5">
              {visible.map((skill) => (
                <div
                  key={skill.id}
                  className="group flex min-w-0 items-center rounded-2xl border border-border-subtle hover:bg-accent/50">
                  <Button
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-2xl p-3 text-left hover:bg-transparent"
                    onClick={(event) => {
                      trigger.current = event.currentTarget
                      setSelected(skill)
                    }}>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent">
                      <Sparkles className="size-4 text-muted-foreground" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium" title={skill.name}>
                        {displayName(skill)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {skill.description || t('library.skill_detail.no_description')}
                      </span>
                    </span>
                  </Button>
                  <MySkillMenu skill={skill} name={displayName(skill)} manager={tags} />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      <LocalSkillDetailDialog
        displayName={selected ? displayName(selected) : undefined}
        skill={selected ? (owned.find((skill) => skill.id === selected.id) ?? null) : null}
        onClose={() => setSelected(null)}
        onReturnFocus={() => trigger.current?.focus()}
      />
      {importOpen ? (
        <Suspense fallback={null}>
          <ImportSkillDialog open onOpenChange={setImportOpen} requireConfirmation />
        </Suspense>
      ) : null}
    </div>
  )
}
