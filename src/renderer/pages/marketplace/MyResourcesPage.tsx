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
import { useDataChange, useQuery } from '@data/hooks/useDataApi'
import { ResourceCatalogSearchInput } from '@renderer/components/resourceCatalog/ResourceCatalogSearchInput'
import { useInstalledSkills, useReconcileSkillsOnOpen } from '@renderer/hooks/useSkills'
import { toast } from '@renderer/services/toast'
import type { InstalledSkill } from '@shared/types/skill'
import { localizeMarketplaceText, marketplaceSkillSource } from '@shared/utils/cherrySkillMarketplace'

import type { LibraryResourceKind } from './LibraryCreateDialog'
import { LibraryLoadError, LibraryResourceList } from './LibraryResourceList'
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
const LibraryCreateDialog = lazy(() => import('./LibraryCreateDialog'))
type LibraryKind = 'skill' | LibraryResourceKind
export default function MyResourcesPage({ onBrowseTemplates }: { onBrowseTemplates: () => void }) {
  const { t, i18n } = useTranslation()
  const { data: catalog } = useSWR('skill.marketplace.list', loadMarketplaceSkills, {
    revalidateOnFocus: false,
    shouldRetryOnError: false
  })
  const { skills, loading, error, refresh } = useInstalledSkills()
  useReconcileSkillsOnOpen(true)
  const [kind, setKind] = useState<LibraryKind>('skill')
  const [queries, setQueries] = useState({ skill: '', prompt: '', assistant: '', agent: '' })
  const query = queries[kind]
  const setQuery = (value: string) => setQueries((current) => ({ ...current, [kind]: value }))
  const [filterStates, setFilterStates] = useState({
    skill: DEFAULT_LIBRARY_FILTERS,
    prompt: DEFAULT_LIBRARY_FILTERS,
    assistant: DEFAULT_LIBRARY_FILTERS,
    agent: DEFAULT_LIBRARY_FILTERS
  })
  const storedFilters = filterStates[kind]
  const setFilters = (value: typeof DEFAULT_LIBRARY_FILTERS) =>
    setFilterStates((current) => ({ ...current, [kind]: value }))
  const prompts = useQuery('/prompts')
  const assistants = useQuery('/assistants', { query: { page: 1, limit: 1, inTrash: false } })
  const agents = useQuery('/agents', { query: { page: 1, limit: 1, inTrash: false } })
  useDataChange('/prompts', () => void prompts.refetch())
  useDataChange('/assistants', () => void assistants.refetch())
  useDataChange('/agents', () => void agents.refetch())
  const [createKind, setCreateKind] = useState<LibraryResourceKind | null>(null)
  const [createdRevision, setCreatedRevision] = useState(0)
  const scroll = useRef<HTMLDivElement | null>(null)
  const onCreated = (type: LibraryResourceKind) => {
    setCreateKind(null)
    setQueries((current) => ({ ...current, [type]: '' }))
    setFilterStates((current) => ({ ...current, [type]: DEFAULT_LIBRARY_FILTERS }))
    setCreatedRevision((value) => value + 1)
    setKind(type)
    scroll.current?.scrollTo({ top: 0 })
  }
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
            {
              type: 'skill' as const,
              label: 'marketplace.type.skill',
              icon: Sparkles,
              count: loading || error ? '—' : owned.length
            },
            {
              type: 'prompt' as const,
              label: 'marketplace.type.prompt',
              icon: FileText,
              count: prompts.error ? '—' : (prompts.data?.length ?? '—')
            },
            {
              type: 'assistant' as const,
              label: 'library.type.assistant',
              icon: MessageSquare,
              count: assistants.error ? '—' : (assistants.data?.total ?? '—')
            },
            {
              type: 'agent' as const,
              label: 'marketplace.type.agent',
              icon: Bot,
              count: agents.error ? '—' : (agents.data?.total ?? '—')
            }
          ].map(({ type, label, icon: Icon, count }) => (
            <Button
              key={label}
              variant="ghost"
              onClick={() => {
                setKind(type)
                scroll.current?.scrollTo({ top: 0 })
              }}
              aria-pressed={kind === type}
              className={`h-9 w-full justify-start rounded-xl px-2 ${kind === type ? 'bg-accent' : ''}`}>
              <Icon className="size-4" strokeWidth={1.5} />
              {t(label)}
              <span className="ml-auto text-xs text-foreground-tertiary">{count}</span>
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
          <MyResourcesFilter
            value={filters}
            onChange={setFilters}
            manager={tags}
            counts={kind === 'skill' ? tagCounts : undefined}
            skillFilters={kind === 'skill'}
          />
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
                  { type: 'Prompt', icon: FileText, create: 'prompt' as const },
                  { type: t('library.type.assistant'), icon: MessageSquare, create: 'assistant' as const },
                  { type: t('library.type.agent'), icon: Bot, create: 'agent' as const }
                ].map(({ type, icon: Icon, create }) => (
                  <DropdownMenuItem key={type} onSelect={() => setCreateKind(create)}>
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
        <div
          ref={scroll}
          className="min-h-0 flex-1 overflow-y-auto p-5"
          aria-busy={kind === 'skill' ? loading : kind === 'prompt' && prompts.isLoading}>
          {kind !== 'skill' ? (
            kind === 'prompt' && prompts.error ? (
              <LibraryLoadError retry={prompts.refetch} />
            ) : kind === 'prompt' && prompts.isLoading ? (
              <Spinner text={t('common.loading')} />
            ) : (
              <LibraryResourceList
                key={`${kind}:${query}:${filters.sort}:${JSON.stringify(filters.tags)}:${createdRevision}`}
                kind={kind}
                query={query}
                sort={filters.sort}
                tagIds={filters.tags}
                prompts={prompts.data ?? []}
                manager={tags}
              />
            )
          ) : loading ? (
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
                  className="group flex min-w-0 items-center rounded-2xl border border-border-subtle transition-[box-shadow,translate] duration-200 ease-out hover:shadow-md motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none">
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
      {createKind ? (
        <Suspense fallback={null}>
          <LibraryCreateDialog kind={createKind} onClose={() => setCreateKind(null)} onCreated={onCreated} />
        </Suspense>
      ) : null}
    </div>
  )
}
