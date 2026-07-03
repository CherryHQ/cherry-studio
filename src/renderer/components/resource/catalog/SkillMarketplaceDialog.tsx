import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  SearchInput,
  SegmentedControl
} from '@cherrystudio/ui'
import { useSkillInstall, useSkillSearch } from '@renderer/hooks/useSkills'
import type { SkillSearchResult, SkillSearchSource } from '@shared/types/skill'
import { Check, Download, ExternalLink, Loader2, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled?: () => void
}

const SEARCH_SOURCES: SkillSearchSource[] = ['claude-plugins.dev', 'skills.sh', 'clawhub.ai']

export function SkillMarketplaceDialog({ open, onOpenChange, onInstalled }: Props) {
  const { t } = useTranslation()
  const { results, searching, error, search, clear } = useSkillSearch()
  const { install, isInstalling } = useSkillInstall()
  const [query, setQuery] = useState('')
  const [activeSource, setActiveSource] = useState<SkillSearchSource>('claude-plugins.dev')
  const [installedSources, setInstalledSources] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (open) return
    setQuery('')
    setActiveSource('claude-plugins.dev')
    setInstalledSources(new Set())
    clear()
  }, [clear, open])

  const tabCounts = useMemo(() => {
    const counts = new Map<SkillSearchSource, number>()
    for (const result of results) {
      counts.set(result.sourceRegistry, (counts.get(result.sourceRegistry) ?? 0) + 1)
    }
    return counts
  }, [results])

  const visibleResults = useMemo(
    () => results.filter((result) => result.sourceRegistry === activeSource),
    [activeSource, results]
  )

  const handleSearchChange = useCallback(
    (value: string) => {
      setQuery(value)
      if (value.trim()) {
        void search(value)
      } else {
        clear()
      }
    },
    [clear, search]
  )

  const handleInstall = useCallback(
    async (result: SkillSearchResult) => {
      if (installedSources.has(result.installSource) || isInstalling()) return

      const { skill, error: installError } = await install(result.installSource)
      if (!skill) {
        const message = t('settings.skills.installFailed', { name: result.name })
        window.toast.error(installError ? `${message}: ${installError}` : message)
        return
      }

      setInstalledSources((current) => new Set(current).add(result.installSource))
      window.toast.success(t('settings.skills.installSuccess', { name: skill.name }))
      onInstalled?.()
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

  const clearQuery = useCallback(() => handleSearchChange(''), [handleSearchChange])

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        closeOnOverlayClick={!isInstalling()}
        size="xl"
        className="flex h-[min(640px,82vh)] flex-col gap-0 overflow-hidden p-0"
        data-testid="skill-marketplace-dialog">
        <div className="shrink-0 border-border-muted border-b px-6 pt-5 pb-4">
          <DialogHeader className="text-left">
            <DialogTitle>{t('library.skill_marketplace.title')}</DialogTitle>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-3">
            <SearchInput
              value={query}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder={t('library.skill_marketplace.search_placeholder')}
              onClear={clearQuery}
              clearLabel={t('common.clear')}
            />
            <SegmentedControl<SkillSearchSource>
              size="sm"
              value={activeSource}
              onValueChange={setActiveSource}
              className="self-start"
              options={SEARCH_SOURCES.map((source) => {
                const count = tabCounts.get(source) ?? 0
                return {
                  value: source,
                  label: (
                    <>
                      {source}
                      {count > 0 ? <span className="text-foreground-muted text-xs tabular-nums">{count}</span> : null}
                    </>
                  )
                }
              })}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-1">
          <SkillSearchBody
            query={query}
            error={error}
            searching={searching}
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

  if (!query.trim()) {
    return (
      <EmptyState
        preset="no-resource"
        title={t('library.skill_marketplace.empty_title')}
        description={t('library.skill_marketplace.empty_description')}
        className="h-full"
      />
    )
  }

  if (searching) {
    return (
      <div className="flex h-full items-center justify-center text-foreground-muted text-sm">
        <Loader2 size={16} className="mr-2 animate-spin" />
        {t('common.loading')}
      </div>
    )
  }

  if (error) {
    return <EmptyState preset="no-result" title={t('common.error')} description={error} className="h-full" />
  }

  if (results.length === 0) {
    return (
      <EmptyState
        preset="no-result"
        title={t('library.skill_marketplace.no_results_title')}
        description={t('library.skill_marketplace.no_results_description')}
        className="h-full"
      />
    )
  }

  return (
    <div className="divide-y divide-border-muted">
      {results.map((result) => (
        <SkillSearchResultRow
          key={`${result.sourceRegistry}:${result.slug}`}
          result={result}
          installed={installedSources.has(result.installSource)}
          installing={isInstalling(result.installSource)}
          disabled={isInstalling()}
          onInstall={() => onInstall(result)}
        />
      ))}
    </div>
  )
}

function SkillSearchResultRow({
  result,
  installed,
  installing,
  disabled,
  onInstall
}: {
  result: SkillSearchResult
  installed: boolean
  installing: boolean
  disabled: boolean
  onInstall: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex items-start gap-4 px-6 py-3.5 transition-colors hover:bg-accent">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-sm leading-5">
          <div className="truncate font-medium text-foreground">{result.name}</div>
        </div>
        {result.description ? (
          <div className="mt-1 line-clamp-2 max-w-[560px] text-foreground-secondary text-sm leading-6">
            {result.description}
          </div>
        ) : null}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-foreground-muted text-xs">
          {result.author ? <span className="truncate">{result.author}</span> : null}
          <span className="truncate">{result.sourceRegistry}</span>
          {result.stars > 0 ? (
            <span className="flex shrink-0 items-center gap-1">
              <Star size={11} />
              {result.stars}
            </span>
          ) : null}
          {result.downloads > 0 ? (
            <span className="flex shrink-0 items-center gap-1">
              <Download size={11} />
              {result.downloads}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {result.sourceUrl ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.skills.viewSource')}
            onClick={() => window.open(result.sourceUrl!)}
            className="text-foreground-muted hover:text-foreground">
            <ExternalLink size={13} />
          </Button>
        ) : null}
        <Button
          variant={installed ? 'ghost' : 'secondary'}
          size="sm"
          onClick={onInstall}
          disabled={installed || disabled}
          className="min-w-20 justify-center">
          {installing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : installed ? (
            <Check size={12} />
          ) : (
            <Download size={12} />
          )}
          <span>{installed ? t('settings.skills.installed') : t('settings.skills.install')}</span>
        </Button>
      </div>
    </div>
  )
}
