import {
  Button,
  Center,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  SegmentedControl,
  Spinner,
  Tooltip
} from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useSkillInstall, useSkillSearch } from '@renderer/hooks/useSkills'
import type { SkillSearchResult, SkillSearchSource } from '@shared/types/skill'
import { Check, Download, ExternalLink, Loader2, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceCatalogSearchInput } from './ResourceCatalogSearchInput'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled?: () => void
}

const SEARCH_SOURCES: SkillSearchSource[] = ['skills.sh', 'claude-plugins.dev', 'clawhub.ai']
const DEFAULT_SEARCH_SOURCE: SkillSearchSource = 'skills.sh'
const SEARCH_DEBOUNCE_MS = 300
const SKILL_SEARCH_RESULT_ROW_ESTIMATE_PX = 64

export function SkillMarketplaceDialog({ open, onOpenChange, onInstalled }: Props) {
  const { t } = useTranslation()
  const { results, searching, error, search, clear } = useSkillSearch()
  const { install, isInstalling } = useSkillInstall()
  const [query, setQuery] = useState('')
  const [activeSource, setActiveSource] = useState<SkillSearchSource>(DEFAULT_SEARCH_SOURCE)
  const [installedSources, setInstalledSources] = useState<Set<string>>(() => new Set())
  const [searchDebouncing, setSearchDebouncing] = useState(false)
  const pendingInstallSourcesRef = useRef<Set<string>>(new Set())
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasQuery = query.trim() !== ''

  const clearPendingSearch = useCallback(() => {
    if (!searchDebounceRef.current) return
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = null
  }, [])

  useEffect(() => {
    if (open) return
    clearPendingSearch()
    setQuery('')
    setActiveSource(DEFAULT_SEARCH_SOURCE)
    setInstalledSources(new Set())
    setSearchDebouncing(false)
    pendingInstallSourcesRef.current.clear()
    clear()
  }, [clear, clearPendingSearch, open])

  useEffect(() => clearPendingSearch, [clearPendingSearch])

  const tabCounts = useMemo(() => {
    const counts = new Map<SkillSearchSource, number>()
    for (const result of results) {
      counts.set(result.sourceRegistry, (counts.get(result.sourceRegistry) ?? 0) + 1)
    }
    return counts
  }, [results])

  const firstSourceWithResults = useMemo(
    () => SEARCH_SOURCES.find((source) => (tabCounts.get(source) ?? 0) > 0) ?? null,
    [tabCounts]
  )

  const selectedSource =
    hasQuery && results.length > 0 && (tabCounts.get(activeSource) ?? 0) === 0 && firstSourceWithResults
      ? firstSourceWithResults
      : activeSource

  const visibleResults = useMemo(
    () => results.filter((result) => result.sourceRegistry === selectedSource),
    [selectedSource, results]
  )

  useEffect(() => {
    if (activeSource !== selectedSource) {
      setActiveSource(selectedSource)
    }
  }, [activeSource, selectedSource])

  const handleSearchChange = useCallback(
    (value: string) => {
      setQuery(value)
      clearPendingSearch()
      clear()
      if (value.trim()) {
        setSearchDebouncing(true)
        searchDebounceRef.current = setTimeout(() => {
          searchDebounceRef.current = null
          setSearchDebouncing(false)
          void search(value)
        }, SEARCH_DEBOUNCE_MS)
      } else {
        setSearchDebouncing(false)
      }
    },
    [clear, clearPendingSearch, search]
  )

  const handleInstall = useCallback(
    async (result: SkillSearchResult) => {
      if (
        installedSources.has(result.installSource) ||
        pendingInstallSourcesRef.current.has(result.installSource) ||
        isInstalling(result.installSource)
      ) {
        return
      }

      pendingInstallSourcesRef.current.add(result.installSource)
      try {
        const { skill, error: installError } = await install(result.installSource)
        if (!skill) {
          const message = t('settings.skills.installFailed', { name: result.name })
          window.toast.error(installError ? `${message}: ${installError}` : message)
          return
        }

        setInstalledSources((current) => new Set(current).add(result.installSource))
        window.toast.success(t('settings.skills.installSuccess', { name: skill.name }))
        onInstalled?.()
      } finally {
        pendingInstallSourcesRef.current.delete(result.installSource)
      }
    },
    [install, installedSources, isInstalling, onInstalled, t]
  )

  const close = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isInstalling()) return
      onOpenChange(nextOpen)
    },
    [isInstalling, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        closeOnOverlayClick
        size="xl"
        className="flex h-[min(640px,82vh)] flex-col gap-0 overflow-hidden p-0"
        data-testid="skill-marketplace-dialog">
        <div className="shrink-0 border-border-muted border-b px-6 pt-5 pb-4">
          <DialogHeader className="text-left">
            <DialogTitle>{t('library.skill_marketplace.title')}</DialogTitle>
          </DialogHeader>

          <div className="mt-3 flex items-center gap-3">
            <SegmentedControl<SkillSearchSource>
              size="sm"
              value={selectedSource}
              onValueChange={setActiveSource}
              className="shrink-0"
              options={SEARCH_SOURCES.map((source) => {
                const count = tabCounts.get(source) ?? 0
                return {
                  value: source,
                  disabled: hasQuery && results.length > 0 && count === 0,
                  label: (
                    <>
                      {source}
                      {count > 0 ? <span className="text-foreground-muted text-xs tabular-nums">{count}</span> : null}
                    </>
                  )
                }
              })}
            />
            <ResourceCatalogSearchInput
              value={query}
              onValueChange={handleSearchChange}
              placeholder={t('library.skill_marketplace.search_placeholder')}
              className="ml-auto min-w-0 max-w-[560px] flex-1"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <SkillSearchBody
            query={query}
            error={error}
            searching={searching || searchDebouncing}
            results={visibleResults}
            installedSources={installedSources}
            isInstalling={isInstalling}
            onInstall={handleInstall}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SkillSearchBody({
  query,
  error,
  searching,
  results,
  installedSources,
  isInstalling,
  onInstall
}: {
  query: string
  error: string | null
  searching: boolean
  results: SkillSearchResult[]
  installedSources: Set<string>
  isInstalling: (key?: string) => boolean
  onInstall: (result: SkillSearchResult) => void
}) {
  const { t } = useTranslation()
  const getResultKey = useCallback(
    (index: number) => {
      const result = results[index]
      return result ? `${result.sourceRegistry}:${result.slug}` : index
    },
    [results]
  )

  if (!query.trim()) {
    return (
      <EmptyState
        preset="no-resource"
        title={t('library.skill_marketplace.empty_title')}
        description={t('library.skill_marketplace.empty_description')}
        className="min-h-0 flex-1"
      />
    )
  }

  if (searching) {
    return (
      <Center className="min-h-0 flex-1 text-foreground-muted text-sm">
        <Spinner text={t('common.loading')} />
      </Center>
    )
  }

  if (error) {
    return (
      <EmptyState
        preset="no-result"
        title={t('common.error')}
        description={t('library.skill_marketplace.search_failed_description')}
        className="min-h-0 flex-1"
      />
    )
  }

  if (results.length === 0) {
    return (
      <EmptyState
        preset="no-result"
        title={t('library.skill_marketplace.no_results_title')}
        description={t('library.skill_marketplace.no_results_description')}
        className="min-h-0 flex-1"
      />
    )
  }

  return (
    <DynamicVirtualList
      list={results}
      size="100%"
      estimateSize={() => SKILL_SEARCH_RESULT_ROW_ESTIMATE_PX}
      overscan={6}
      getItemKey={getResultKey}
      role="list"
      className="[&::-webkit-scrollbar]:!w-0.75 box-border px-6 pt-1 pb-1 [&::-webkit-scrollbar-thumb]:rounded-full">
      {(result, index) => (
        <SkillSearchResultRow
          result={result}
          last={index === results.length - 1}
          installed={installedSources.has(result.installSource)}
          installing={isInstalling(result.installSource)}
          onInstall={() => onInstall(result)}
        />
      )}
    </DynamicVirtualList>
  )
}

function SkillSearchResultRow({
  result,
  last,
  installed,
  installing,
  onInstall
}: {
  result: SkillSearchResult
  last: boolean
  installed: boolean
  installing: boolean
  onInstall: () => void
}) {
  const { t } = useTranslation()
  const hasMeta = result.stars > 0 || result.downloads > 0

  return (
    <div
      role="listitem"
      className={`mx-auto flex min-h-[56px] w-full max-w-3xl items-center gap-4 px-2 py-2 ${last ? '' : 'border-border-muted border-b'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex h-4 min-w-0 items-center gap-1.5 text-[13px] leading-4">
          <div className="min-w-0 truncate font-semibold text-foreground leading-4">{result.name}</div>
          {result.sourceUrl ? (
            <Tooltip content={t('settings.skills.viewSource')} delay={300}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('settings.skills.viewSource')}
                onClick={() => window.open(result.sourceUrl!)}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm p-0 text-foreground-muted shadow-none hover:bg-accent hover:text-foreground">
                <ExternalLink className="size-3" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
        {hasMeta ? (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-foreground-muted leading-[14px]">
            {result.stars > 0 ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <Star className="size-3" />
                {result.stars}
              </span>
            ) : null}
            {result.downloads > 0 ? (
              <span className="flex shrink-0 items-center gap-0.5">
                <Download className="size-3" />
                {result.downloads}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        <Button
          variant={installed ? 'ghost' : 'outline'}
          size="sm"
          onClick={onInstall}
          disabled={installed || installing}
          aria-busy={installing || undefined}
          className="h-7 min-h-0 min-w-[64px] justify-center gap-1 rounded-lg border-border-muted bg-background px-2 text-xs shadow-none hover:bg-accent">
          {installing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : installed ? (
            <Check className="size-3.5" />
          ) : (
            <Download className="size-3.5" />
          )}
          <span>{installed ? t('settings.skills.installed') : t('settings.skills.install')}</span>
        </Button>
      </div>
    </div>
  )
}
