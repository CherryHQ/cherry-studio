import {
  Button,
  Center,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tooltip
} from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useSkillInstall, useSkillSearch } from '@renderer/hooks/useSkills'
import { toast } from '@renderer/services/toast'
import type { SkillSearchResult, SkillSearchSource } from '@shared/types/skill'
import { buildGithubSkillResult } from '@shared/utils/skillMarketplace'
import { Check, Download, ExternalLink, Loader2, Star } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceCatalogSearchInput } from '../../ResourceCatalogSearchInput'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SOURCE_LABELS: Record<SkillSearchSource, string> = {
  'skills.sh': 'skills.sh',
  'claude-plugins.dev': 'claude-plugins.dev',
  'clawhub.ai': 'clawhub.ai',
  github: 'GitHub'
}
const SEARCH_SOURCES = Object.keys(SOURCE_LABELS) as SkillSearchSource[]
const DEFAULT_SEARCH_SOURCE: SkillSearchSource = 'skills.sh'
const SEARCH_DEBOUNCE_MS = 300
const SKILL_SEARCH_RESULT_ROW_ESTIMATE_PX = 64

export function SkillMarketplaceDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation()
  const { results, searching, error, search, clear } = useSkillSearch()
  const { install, isInstalling } = useSkillInstall()
  const [query, setQuery] = useState('')
  const [submittedUrl, setSubmittedUrl] = useState('')
  const [activeSource, setActiveSource] = useState<SkillSearchSource>(DEFAULT_SEARCH_SOURCE)
  const [installedSources, setInstalledSources] = useState<Set<string>>(() => new Set())
  const [searchDebouncing, setSearchDebouncing] = useState(false)
  const pendingInstallSourcesRef = useRef<Set<string>>(new Set())
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const urlErrorId = useId()
  const isGithubSource = activeSource === 'github'

  const clearPendingSearch = useCallback(() => {
    if (!searchDebounceRef.current) return
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = null
  }, [])

  useEffect(() => {
    if (open) return
    clearPendingSearch()
    setQuery('')
    setSubmittedUrl('')
    setActiveSource(DEFAULT_SEARCH_SOURCE)
    setInstalledSources(new Set())
    setSearchDebouncing(false)
    pendingInstallSourcesRef.current.clear()
    clear()
  }, [clear, clearPendingSearch, open])

  useEffect(() => clearPendingSearch, [clearPendingSearch])

  // GitHub installs one skill from the URL itself — the registries have nothing to search.
  const githubResult = useMemo(
    () => (isGithubSource && submittedUrl.trim() ? buildGithubSkillResult(submittedUrl) : null),
    [isGithubSource, submittedUrl]
  )

  const sourceCounts = useMemo(() => {
    const counts = new Map<SkillSearchSource, number>()
    for (const result of githubResult ? [...results, githubResult] : results) {
      counts.set(result.sourceRegistry, (counts.get(result.sourceRegistry) ?? 0) + 1)
    }
    return counts
  }, [githubResult, results])
  const githubUrlInvalid = isGithubSource && submittedUrl.trim().length > 0 && !githubResult

  const visibleResults = useMemo(() => {
    if (isGithubSource) return githubResult ? [githubResult] : []
    return results.filter((result) => result.sourceRegistry === activeSource)
  }, [activeSource, githubResult, isGithubSource, results])

  const handleSearchChange = useCallback(
    (value: string) => {
      setQuery(value)
      setSubmittedUrl('')
      clearPendingSearch()
      clear()
      if (value.trim()) {
        setSearchDebouncing(true)
        searchDebounceRef.current = setTimeout(() => {
          searchDebounceRef.current = null
          setSearchDebouncing(false)
          if (isGithubSource) setSubmittedUrl(value)
          else void search(value)
        }, SEARCH_DEBOUNCE_MS)
      } else {
        setSearchDebouncing(false)
      }
    },
    [clear, clearPendingSearch, isGithubSource, search]
  )

  const handleSourceChange = useCallback(
    (value: string) => {
      const nextSource = value as SkillSearchSource
      setActiveSource(nextSource)
      // The registries share one search, so switching among them only refilters. GitHub takes a URL
      // instead of keywords, so whatever was typed no longer applies in either direction.
      if ((nextSource === 'github') === isGithubSource) return
      clearPendingSearch()
      clear()
      setQuery('')
      setSubmittedUrl('')
      setSearchDebouncing(false)
    },
    [clear, clearPendingSearch, isGithubSource]
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
          toast.error(installError ? `${message}: ${installError}` : message)
          return
        }

        setInstalledSources((current) => new Set(current).add(result.installSource))
        toast.success(t('settings.skills.installSuccess', { name: skill.name }))
      } finally {
        pendingInstallSourcesRef.current.delete(result.installSource)
      }
    },
    [install, installedSources, isInstalling, t]
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
        <div className="shrink-0 border-border-subtle border-b px-6 pt-5 pb-4">
          <DialogHeader className="text-left">
            <DialogTitle>{t('library.skill_marketplace.title')}</DialogTitle>
          </DialogHeader>

          <div className="mt-3 flex items-start gap-3">
            <Select value={activeSource} onValueChange={handleSourceChange}>
              <SelectTrigger
                size="sm"
                aria-label={t('library.skill_marketplace.source_label')}
                className="w-[184px] shrink-0">
                <SelectValue>{SOURCE_LABELS[activeSource]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SEARCH_SOURCES.map((source) => {
                  const count = sourceCounts.get(source) ?? 0
                  return (
                    <SelectItem key={source} value={source}>
                      {SOURCE_LABELS[source]}
                      {count > 0 ? (
                        <span className="text-foreground-tertiary text-xs tabular-nums">{count}</span>
                      ) : null}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <div className="ml-auto flex min-w-0 max-w-[560px] flex-1 flex-col gap-1">
              <ResourceCatalogSearchInput
                value={query}
                onValueChange={handleSearchChange}
                placeholder={t(
                  isGithubSource
                    ? 'library.skill_marketplace.github_url_placeholder'
                    : 'library.skill_marketplace.search_placeholder'
                )}
                aria-label={t(
                  isGithubSource
                    ? 'library.skill_marketplace.github_url_label'
                    : 'library.skill_marketplace.search_label'
                )}
                aria-invalid={githubUrlInvalid || undefined}
                aria-describedby={githubUrlInvalid ? urlErrorId : undefined}
              />
              {githubUrlInvalid ? (
                <p id={urlErrorId} role="alert" className="text-error text-xs leading-4">
                  {t('library.skill_marketplace.github_url_invalid')}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <SkillSearchBody
            query={isGithubSource ? (githubResult ? submittedUrl : '') : query}
            emptyTitle={t(
              isGithubSource ? 'library.skill_marketplace.github_empty_title' : 'library.skill_marketplace.empty_title'
            )}
            emptyDescription={t(
              isGithubSource
                ? 'library.skill_marketplace.github_empty_description'
                : 'library.skill_marketplace.empty_description'
            )}
            error={isGithubSource ? null : error}
            searching={!isGithubSource && (searching || searchDebouncing)}
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
  emptyTitle,
  emptyDescription,
  error,
  searching,
  results,
  installedSources,
  isInstalling,
  onInstall
}: {
  query: string
  emptyTitle: string
  emptyDescription: string
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
      <EmptyState preset="no-resource" title={emptyTitle} description={emptyDescription} className="min-h-0 flex-1" />
    )
  }

  if (searching) {
    return (
      <Center className="min-h-0 flex-1 text-foreground-tertiary text-sm">
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
      className={`mx-auto flex min-h-[56px] w-full max-w-3xl items-center gap-4 px-2 py-2 ${last ? '' : 'border-border-subtle border-b'}`}>
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
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground">
                <ExternalLink className="size-3" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
        {hasMeta ? (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-foreground-tertiary leading-[14px]">
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
          className="h-7 min-h-0 min-w-[64px] justify-center gap-1 rounded-lg border-border-subtle bg-background px-2 text-xs shadow-none hover:bg-accent">
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
