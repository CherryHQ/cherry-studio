import { useNavigate, useSearch } from '@tanstack/react-router'
import { Bot, Layers, Network, Settings2, Sparkles } from 'lucide-react'
import { Activity, lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Spinner } from '@cherrystudio/ui'
import { ResourceCatalogSearchInput } from '@renderer/components/resourceCatalog/ResourceCatalogSearchInput'
import { useAgentCatalogPresets } from '@renderer/hooks/useAgentCatalogPresets'
import { buildAssistantCatalogTabs, useAssistantCatalogPresets } from '@renderer/hooks/useAssistantCatalogPresets'
import { useBuiltinMcpCatalog } from '@renderer/hooks/useBuiltinMcpCatalog'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import type { MarketplaceResourceType, MarketplaceView } from '@renderer/types/marketplace'

import { MarketplaceMcp } from './MarketplaceMcp'
import { MarketplaceSkills } from './MarketplaceSkills'
import { buildMarketplaceTemplates } from './marketplaceTemplateCatalog'
import { MarketplaceTemplates } from './MarketplaceTemplates'
import { SkillsShCatalog, SKILLS_SH_SOURCE_ID } from './SkillsShCatalog'
import { SkillSubscriptionBar } from './SkillSubscriptionBar'
import { useMarketplace } from './useMarketplace'

// The personal library is not released yet; keep the "My Resources" navigation entry hidden.
const MyResourcesPage = lazy(() => import('./MyResourcesPage'))
const RESOURCE_TYPES = [
  { id: 'all', label: 'common.all', icon: Layers },
  { id: 'skill', label: 'marketplace.type.skill', icon: Sparkles },
  { id: 'mcp', label: 'marketplace.type.mcp', icon: Network },
  { id: 'agent', label: 'marketplace.type.agent', icon: Bot }
] as const
const OVERVIEW_TYPES = ['skill', 'agent', 'mcp'] as const

export default function MarketplacePage() {
  const { t } = useTranslation()
  const { view } = useSearch({ from: '/app/marketplace' })
  const navigate = useNavigate({ from: '/app/marketplace' })
  return (
    <>
      <Activity mode={view === 'mine' ? 'hidden' : 'visible'}>
        <MarketplaceCatalog active={view !== 'mine'} />
      </Activity>
      <Activity mode={view === 'mine' ? 'visible' : 'hidden'}>
        <Suspense fallback={<Spinner text={t('common.loading')} />}>
          <MyResourcesPage onBrowseTemplates={() => void navigate({ search: {} })} />
        </Suspense>
      </Activity>
    </>
  )
}

function MarketplaceCatalog({ active }: { active: boolean }) {
  const { t, i18n } = useTranslation()
  const [resourceType, setResourceType] = useState<MarketplaceView>('all')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [queries, setQueries] = useState<Record<MarketplaceView, string>>({
    all: '',
    skill: '',
    agent: '',
    mcp: ''
  })
  const [templateCategory, setTemplateCategory] = useState('')
  const [moreMcpSources, setMoreMcpSources] = useState(false)
  const query = queries[resourceType]
  const skillSourceId = resourceType === 'skill' ? sourceId : null
  const isSkillsSh = skillSourceId === SKILLS_SH_SOURCE_ID
  const skills = useMarketplace(
    isSkillsSh ? null : skillSourceId,
    active && !isSkillsSh && (resourceType === 'all' || resourceType === 'skill')
  )
  const agents = useAgentCatalogPresets({ enabled: active && (resourceType === 'all' || resourceType === 'agent') })
  const assistants = useAssistantCatalogPresets({
    enabled: active && (resourceType === 'all' || resourceType === 'agent')
  })
  const mcp = useBuiltinMcpCatalog()
  const templates = useMemo(
    () => buildMarketplaceTemplates(agents.items, assistants.presets, i18n.language),
    [agents.items, assistants.presets, i18n.language]
  )
  const categories = useMemo(
    () =>
      buildAssistantCatalogTabs(
        templates.map((item) => ({ id: item.id, name: item.name, group: item.groups })),
        0,
        ''
      )
        .slice(1)
        .map((tab) => tab.id),
    [templates]
  )
  const counts: Record<MarketplaceView, number | null> = {
    skill: isSkillsSh ? null : skillSourceId ? (skills.catalog.data?.length ?? null) : skills.curatedCount,
    agent: agents.isLoading || agents.error || assistants.isLoading || assistants.error ? null : templates.length,
    mcp: mcp.presets.length,
    all: null
  }
  const curatedCounts = [skills.curatedCount, counts.agent, counts.mcp]
  if (curatedCounts.every((count) => count !== null))
    counts.all = curatedCounts.reduce<number>((sum, count) => sum + (count ?? 0), 0)
  const browse = (type: MarketplaceResourceType) => {
    setQueries((current) => ({ ...current, [type]: query }))
    if (type === 'skill') setSourceId(null)
    if (type === 'agent') setTemplateCategory('')
    if (type === 'mcp') setMoreMcpSources(false)
    setResourceType(type)
  }
  const renderCatalog = (type: MarketplaceResourceType, preview = false) => {
    if (type === 'skill' && !preview && isSkillsSh) return <SkillsShCatalog query={query} active={active} />
    if (type === 'skill') return <MarketplaceSkills market={skills} query={query} preview={preview} active={active} />
    if (type === 'mcp')
      return (
        <MarketplaceMcp
          catalog={mcp}
          query={query}
          preview={preview}
          moreSources={!preview && moreMcpSources}
          active={active}
        />
      )
    return (
      <MarketplaceTemplates
        items={templates}
        query={query}
        preview={preview}
        active={active}
        loading={agents.isLoading || assistants.isLoading}
        error={agents.error || assistants.error}
        retry={() => {
          agents.retry()
          assistants.retry()
        }}
        category={categories.includes(templateCategory) ? templateCategory : ''}
        categories={categories}
        onCategoryChange={setTemplateCategory}
      />
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="marketplace-page">
      <div className="flex min-h-0 w-full flex-1 gap-6 p-6">
        <aside className="w-36 shrink-0 pt-4 lg:w-44" aria-label={t('marketplace.resource_types')}>
          <h2 className="mb-3 px-3 text-xs text-foreground-tertiary">{t('marketplace.resource_types')}</h2>
          <nav className="space-y-1">
            {RESOURCE_TYPES.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant="ghost"
                aria-pressed={id === resourceType}
                onClick={() => setResourceType(id)}
                data-testid={'marketplace-type-' + id}
                className={
                  'h-9 w-full justify-start rounded-xl px-3 text-sm ' +
                  (id === resourceType ? 'bg-accent' : 'text-muted-foreground')
                }>
                <Icon className="size-4" strokeWidth={1.5} />
                <span>{t(label)}</span>
                <span className="ml-auto text-xs font-normal text-foreground-tertiary">{counts[id] ?? '—'}</span>
              </Button>
            ))}
          </nav>
        </aside>
        <main className="@container flex min-h-0 min-w-0 flex-1 flex-col pt-3">
          <ResourceCatalogSearchInput
            value={query}
            onValueChange={(value) => setQueries((current) => ({ ...current, [resourceType]: value }))}
            placeholder={t('marketplace.search_placeholder')}
            aria-label={t('marketplace.search_placeholder')}
            className={
              'shrink-0 [&_input]:h-10 [&_input]:rounded-xl ' +
              (resourceType === 'skill' || resourceType === 'mcp' ? '' : 'mb-3')
            }
          />
          {resourceType === 'skill' ? (
            <SkillSubscriptionBar
              sourceId={sourceId}
              active={active}
              refreshing={skills.catalog.isValidating}
              onSelect={setSourceId}
              onRefresh={() => void skills.catalog.mutate().catch(() => {})}
            />
          ) : resourceType === 'mcp' ? (
            <div className="flex shrink-0 items-center gap-2 py-3">
              <Button
                size="sm"
                variant={moreMcpSources ? 'ghost' : 'default'}
                className="shrink-0 rounded-full focus-visible:underline"
                aria-pressed={!moreMcpSources}
                style={moreMcpSources ? undefined : { backgroundColor: '#FF5F5F', color: '#ffffff' }}
                onClick={() => setMoreMcpSources(false)}>
                {t('marketplace.curated')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={'shrink-0 rounded-full ' + (moreMcpSources ? 'bg-accent' : '')}
                aria-pressed={moreMcpSources}
                onClick={() => setMoreMcpSources(true)}>
                {t('marketplace.more_sources')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => openSettingsTab('/settings/mcp/servers?mcpStandalone=true')}>
                <Settings2 className="size-4" />
                {t('marketplace.manage_mcp')}
              </Button>
            </div>
          ) : null}
          {resourceType === 'all' ? (
            <div className="min-h-0 flex-1 space-y-7 overflow-y-auto pr-1">
              {OVERVIEW_TYPES.map((type) => (
                <section key={type} data-testid={'marketplace-section-' + type}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium">{t('marketplace.type.' + type)}</h2>
                    <Button variant="ghost" size="sm" onClick={() => browse(type)}>
                      {t('marketplace.view_all')}
                    </Button>
                  </div>
                  {renderCatalog(type, true)}
                </section>
              ))}
            </div>
          ) : (
            <div
              key={resourceType + ':' + (skillSourceId ?? '') + ':' + moreMcpSources}
              className={
                'min-h-0 flex-1 ' +
                (resourceType === 'agent' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto pr-1')
              }>
              {renderCatalog(resourceType)}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
