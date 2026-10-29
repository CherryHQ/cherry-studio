import { Check, Download, Loader2, Plus, Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRInfinite from 'swr/infinite'

import { Spinner } from '@cherrystudio/ui'
import { useInstalledSkills, useSkillInstall, useSkillSearch } from '@renderer/hooks/useSkills'
import { toast } from '@renderer/services/toast'
import { loadSkillsShLeaderboard } from '@renderer/utils/skillSearch'
import type { SkillSearchResult } from '@shared/types/skill'
import type { MarketplaceSkill } from '@shared/types/skillMarketplace'
import { parseSkillSourceUrl } from '@shared/utils/skillMarketplace'

import { MarketplaceCard, MarketplaceCardAction, MarketplaceGrid, MarketplaceLoadState } from './MarketplaceComponents'
import { MarketplaceSkillDialog } from './MarketplaceSkillDialog'

export const SKILLS_SH_SOURCE_ID = 'skills.sh'
const DISPLAY_PAGE_SIZE = 30

export function SkillsShCatalog({ query, active }: { query: string; active: boolean }) {
  const { t, i18n } = useTranslation()
  const keyword = query.trim()
  const [selected, setSelected] = useState<SkillSearchResult | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => () => setSelected(null), [])
  const [visibleCount, setVisibleCount] = useState(DISPLAY_PAGE_SIZE)
  const sentinel = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const { results, searching, error: searchError, search, clear } = useSkillSearch('skills.sh')
  const [debouncing, setDebouncing] = useState(false)
  const installed = useInstalledSkills()
  const { install, isInstalling } = useSkillInstall()
  const pending = useRef(new Set<string>())
  const ranking = useSWRInfinite(
    (page, previous) =>
      active && !keyword && (!previous || previous.hasMore) ? ['skills.sh.leaderboard', page] : null,
    ([, page]: [string, number]) => loadSkillsShLeaderboard(page),
    { revalidateOnFocus: false, revalidateFirstPage: false, shouldRetryOnError: false }
  )
  const { data, error, isLoading, isValidating, size, setSize, mutate } = ranking
  const ranked = useMemo(() => {
    const unique = new Map<string, SkillSearchResult>()
    for (const page of data ?? [])
      for (const item of page.items) {
        if (!unique.has(item.installSource)) unique.set(item.installSource, item)
      }
    return [...unique.values()]
  }, [data])
  const hasMore = data?.at(-1)?.hasMore ?? false
  const items = keyword ? results : ranked.slice(0, visibleCount)
  const installedSources = useMemo(
    () =>
      new Set(
        installed.skills.flatMap((skill) => {
          const source = skill.sourceUrl ? parseSkillSourceUrl(skill.sourceUrl) : null
          return source ? [source.installSource] : []
        })
      ),
    [installed.skills]
  )

  useEffect(() => {
    clear()
    content.current?.parentElement?.scrollTo({ top: 0 })
    setVisibleCount(DISPLAY_PAGE_SIZE)
    if (!active || !keyword) {
      setDebouncing(false)
      return
    }
    setDebouncing(true)
    const timer = setTimeout(() => {
      setDebouncing(false)
      void search(keyword)
    }, 300)
    return () => clearTimeout(timer)
  }, [active, keyword, clear, search])

  useEffect(() => {
    if (!active || keyword || error || isValidating || !data || data.length < size) return
    if (visibleCount > ranked.length && hasMore) void setSize(size + 1)
  }, [active, keyword, error, isValidating, data, size, visibleCount, ranked.length, hasMore, setSize])

  useEffect(() => {
    if (!active || keyword || error || isLoading || isValidating || !sentinel.current) return
    if (visibleCount > ranked.length || (visibleCount === ranked.length && !hasMore)) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect()
        setVisibleCount((count) => count + DISPLAY_PAGE_SIZE)
      }
    })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [active, keyword, error, isLoading, isValidating, visibleCount, ranked.length, hasMore])

  const add = async (item: SkillSearchResult) => {
    if (pending.current.has(item.installSource)) return
    pending.current.add(item.installSource)
    try {
      const result = await install(item.installSource)
      if (result.skill) {
        toast.success(t('settings.skills.installSuccess', { name: item.name }))
      } else {
        toast.error(result.error || t('settings.skills.installFailed', { name: item.name }))
      }
    } finally {
      pending.current.delete(item.installSource)
    }
  }

  const selectedSource = selected?.sourceUrl ? parseSkillSourceUrl(selected.sourceUrl) : null
  const repository =
    selectedSource?.sourceRegistry === 'skills.sh'
      ? 'https://github.com/' + selectedSource.installSource.slice('skills.sh:'.length).split('/').slice(0, 2).join('/')
      : null
  const selectedSkill: MarketplaceSkill | null = selected
    ? {
        id: selected.installSource,
        name: { en: selected.name, zh: null },
        description: { en: selected.description || '', zh: null },
        domain: '—',
        author: selected.author || '',
        version: '',
        tags: [],
        githubRepoUrl: repository,
        sourceUrl: selected.sourceUrl,
        icon: null,
        packageName: null,
        packageSize: null,
        hasPackage: Boolean(repository),
        downloadUrl: null,
        downloads: selected.downloads,
        releaseDate: '',
        members: [{ path: '', name: selected.name }],
        membersKnown: true,
        isCollection: false
      }
    : null
  const selectedInstalled = selected ? installedSources.has(selected.installSource) : false
  const selectedBusy = selected ? isInstalling(selected.installSource) : false

  return (
    <div ref={content}>
      <MarketplaceLoadState
        loading={keyword ? searching || debouncing : isLoading}
        error={keyword ? searchError : error}
        empty={!items.length}
        retry={() => (keyword ? search(keyword) : mutate())}
      />
      <MarketplaceGrid
        items={items.map((item) => ({ ...item, id: item.installSource }))}
        renderItem={(item) => {
          const added = installedSources.has(item.installSource)
          const busy = isInstalling(item.installSource)
          const supported = parseSkillSourceUrl(item.sourceUrl ?? '')?.sourceRegistry === 'skills.sh'
          return (
            <MarketplaceCard
              name={item.name}
              description={item.description || item.slug.slice(0, item.slug.lastIndexOf('/'))}
              icon={
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-subtle">
                  <Sparkles className="size-5 text-muted-foreground" />
                </span>
              }
              onOpen={(event) => {
                trigger.current = event.currentTarget
                setSelected(item)
              }}
              action={
                <MarketplaceCardAction
                  title={t(added ? 'marketplace.added' : 'settings.skills.install')}
                  aria-label={t(added ? 'marketplace.added' : 'settings.skills.install') + ': ' + item.name}
                  aria-busy={busy}
                  disabled={added || busy || !supported || installed.loading || Boolean(installed.error)}
                  onClick={() => void add(item)}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : added ? (
                    <Check className="size-4" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </MarketplaceCardAction>
              }>
              <span className="mt-1 flex items-center gap-1 text-xs font-normal text-foreground-tertiary">
                <Download className="size-3" />
                {item.downloads.toLocaleString(i18n.language)}
              </span>
            </MarketplaceCard>
          )
        }}
      />
      {!keyword && (visibleCount < ranked.length || hasMore) ? <div ref={sentinel} className="h-8" /> : null}
      {!keyword && isValidating && !isLoading ? <Spinner text={t('common.loading')} /> : null}
      <MarketplaceSkillDialog
        skill={selectedSkill}
        fetchDetail={false}
        curated={false}
        open={Boolean(selected) && active}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        onReturnFocus={() => trigger.current?.focus()}
        installedCount={selectedInstalled ? 1 : 0}
        installing={selectedBusy}
        installedLoading={installed.loading || Boolean(installed.error)}
        failures={[]}
        onInstall={() => {
          if (selected) void add(selected)
        }}
      />
    </div>
  )
}
