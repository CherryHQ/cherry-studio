import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Bot, Layers, Settings2, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ScrollArea } from '@cherrystudio/ui'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
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
import { RegistrySkillsCatalog } from './RegistrySkillsCatalog'
import { SkillSubscriptionBar } from './SkillSubscriptionBar'
import { useMarketplace } from './useMarketplace'

const RESOURCE_TYPES = [
  { id: 'all', label: 'common.all', icon: Layers },
  { id: 'skill', label: 'marketplace.type.skill', icon: Sparkles },
  { id: 'agent', label: 'marketplace.type.agent', icon: Bot },
  { id: 'mcp', label: 'marketplace.type.mcp', icon: McpLogo }
] as const
const OVERVIEW_TYPES = ['skill', 'agent', 'mcp'] as const
const marketplaceRoute = getRouteApi('/app/marketplace')

export default function MarketplacePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { mcpView, mcpProvider } = marketplaceRoute.useSearch()
  const [selectedType, setSelectedType] = useState<MarketplaceView>('all')
  const resourceType = mcpView || mcpProvider ? 'mcp' : selectedType
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [queries, setQueries] = useState<Record<MarketplaceView, string>>({
    all: '',
    skill: '',
    agent: '',
    mcp: ''
  })
  const [templateCategory, setTemplateCategory] = useState('')
  const moreMcpSources = mcpView === 'sources' || Boolean(mcpProvider)
  const selectResourceType = (type: MarketplaceView) => {
    setSelectedType(type)
    void navigate({
      to: '/app/marketplace',
      search: type === 'mcp' ? { mcpView: moreMcpSources ? 'sources' : 'curated' } : {},
      replace: true
    })
  }
  const query = queries[resourceType]
  const skillSourceId = resourceType === 'skill' ? sourceId : null
  const registrySource = skillSourceId === 'skills.sh' || skillSourceId === 'claude-plugins.dev' ? skillSourceId : null
  const skills = useMarketplace(
    registrySource ? null : skillSourceId,
    !registrySource && (resourceType === 'all' || resourceType === 'skill')
  )
  const agents = useAgentCatalogPresets({ enabled: resourceType === 'all' || resourceType === 'agent' })
  const assistants = useAssistantCatalogPresets({
    enabled: resourceType === 'all' || resourceType === 'agent'
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
    skill: registrySource ? null : skillSourceId ? (skills.catalog.data?.length ?? null) : skills.curatedCount,
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
    selectResourceType(type)
  }
  const renderCatalog = (type: MarketplaceResourceType, preview = false) => {
    if (type === 'skill' && !preview && registrySource)
      return <RegistrySkillsCatalog source={registrySource} query={query} active />
    if (type === 'skill') return <MarketplaceSkills market={skills} query={query} preview={preview} active />
    if (type === 'mcp')
      return (
        <MarketplaceMcp
          catalog={mcp}
          query={query}
          preview={preview}
          moreSources={!preview && moreMcpSources}
          providerKey={mcpProvider}
          onProviderChange={(providerKey) =>
            void navigate({
              to: '/app/marketplace',
              search: { mcpView: 'sources', mcpProvider: providerKey },
              replace: true
            })
          }
          active
        />
      )
    return (
      <MarketplaceTemplates
        items={templates}
        query={query}
        preview={preview}
        active
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
      <div className="flex min-h-0 w-full flex-1 gap-6 px-4 pt-4">
        <aside className="w-36 shrink-0 pt-1 lg:w-44" aria-label={t('marketplace.resource_types')}>
          <h2 className="mb-3 px-3 text-xs text-foreground-tertiary">{t('marketplace.resource_types')}</h2>
          <nav className="space-y-1">
            {RESOURCE_TYPES.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant="ghost"
                aria-pressed={id === resourceType}
                onClick={() => selectResourceType(id)}
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
        <main className="@container flex min-h-0 min-w-0 flex-1 flex-col">
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
              active
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
                style={
                  moreMcpSources ? undefined : { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }
                }
                onClick={() =>
                  void navigate({ to: '/app/marketplace', search: { mcpView: 'curated' }, replace: true })
                }>
                {t('marketplace.curated')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={'shrink-0 rounded-full ' + (moreMcpSources ? 'bg-accent' : '')}
                aria-pressed={moreMcpSources}
                onClick={() =>
                  void navigate({ to: '/app/marketplace', search: { mcpView: 'sources' }, replace: true })
                }>
                {t('marketplace.more_sources')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => openSettingsTab('/settings/mcp/servers')}>
                <Settings2 className="size-4" />
                {t('marketplace.manage_mcp')}
              </Button>
            </div>
          ) : null}
          {resourceType === 'all' ? (
            <ScrollArea className="-mr-4 min-h-0 flex-1" contentProps={{ className: 'space-y-7 pr-5 pb-4' }}>
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
            </ScrollArea>
          ) : (
            <div
              key={resourceType + ':' + (skillSourceId ?? '') + ':' + moreMcpSources}
              className="-mr-4 flex min-h-0 flex-1 flex-col overflow-hidden">
              {resourceType === 'agent' ? (
                renderCatalog(resourceType)
              ) : (
                <ScrollArea className="min-h-0 flex-1" contentProps={{ className: 'pr-5 pb-4' }}>
                  {renderCatalog(resourceType)}
                </ScrollArea>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
