import { ExternalLink, Loader2, Network, Plus, Settings2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Dialog } from '@cherrystudio/ui'
import type { useBuiltinMcpCatalog } from '@renderer/hooks/useBuiltinMcpCatalog'
import { getBuiltInMcpServerDescriptionLabelKey } from '@renderer/i18n/label'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { openExternalWebsite } from '@renderer/services/website'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getProviderDisplayName, MCP_MARKETS, MCP_PROVIDER_ENTRIES } from '@renderer/utils/mcpDiscovery'
import type { McpServerPreset } from '@shared/data/presets/mcpServers'

import {
  MarketplaceCard,
  MarketplaceCardAction,
  MarketplaceDetailBody,
  MarketplaceDetailFooter,
  MarketplaceDetailHeader,
  MarketplaceDetailContent,
  MarketplaceGrid,
  MarketplaceLoadState
} from './MarketplaceComponents'

export function MarketplaceMcp({
  catalog,
  query,
  preview = false,
  moreSources = false,
  active
}: {
  catalog: ReturnType<typeof useBuiltinMcpCatalog>
  query: string
  preview?: boolean
  moreSources?: boolean
  active: boolean
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<McpServerPreset | null>(null)
  useLayoutEffect(
    () => () => {
      setSelected(null)
    },
    []
  )
  const trigger = useRef<HTMLButtonElement | null>(null)
  const keyword = query.trim().toLocaleLowerCase()
  const description = (server: McpServerPreset) => t(getBuiltInMcpServerDescriptionLabelKey(server.name))
  const matches = (values: string[]) => values.join(' ').toLocaleLowerCase().includes(keyword)
  const presets = catalog.presets.filter((preset) => matches([preset.name, description(preset)]))
  const visible = (preview ? presets.slice(0, 6) : presets).map((preset) => ({ ...preset, id: preset.name }))
  const busy = selected ? catalog.adding.has(selected.name) : false
  const configure = (id: string) => {
    setSelected(null)
    openSettingsTab(`/settings/mcp/settings/${id}`)
  }
  const add = async (preset: McpServerPreset) => {
    const existing = catalog.findInstalled(preset)
    if (existing) {
      configure(existing.id)
      return
    }
    try {
      const server = await catalog.add(preset)
      toast.success(t('settings.mcp.addSuccess'))
      if (preset.shouldConfig) configure(server.id)
    } catch (error) {
      toast.error(formatErrorMessageWithPrefix(error, t('settings.mcp.addError')))
    }
  }
  const action = (preset: McpServerPreset, full = false) => {
    const installed = catalog.findInstalled(preset)
    const adding = catalog.adding.has(preset.name)
    const label = t(installed ? 'marketplace.configure' : 'common.add')
    const Action = full ? Button : MarketplaceCardAction
    return (
      <Action
        size={full ? 'sm' : 'icon-sm'}
        aria-busy={adding}
        aria-label={label + ': ' + preset.name}
        title={label}
        disabled={catalog.isLoading || Boolean(catalog.error) || adding}
        onClick={() => void add(preset)}>
        {adding ? (
          <Loader2 className="size-4 animate-spin" />
        ) : installed ? (
          <Settings2 className="size-4" />
        ) : (
          <Plus className="size-4" />
        )}
        {full ? label : null}
      </Action>
    )
  }
  if (moreSources) {
    const providers = MCP_PROVIDER_ENTRIES.filter((provider) => matches([getProviderDisplayName(provider, t)]))
    const markets = MCP_MARKETS.filter((market) => matches([market.name, t(market.descriptionKey)]))
    return (
      <>
        <MarketplaceLoadState empty={!providers.length && !markets.length} />
        {providers.length ? (
          <section className="mb-7">
            <h2 className="mb-3 text-sm font-medium">{t('settings.mcp.providers')}</h2>
            <MarketplaceGrid
              items={providers.map((provider) => ({ ...provider, id: provider.key }))}
              renderItem={(provider) => (
                <MarketplaceCard
                  name={getProviderDisplayName(provider, t)}
                  description={t('marketplace.manage_mcp')}
                  icon={<provider.logo.Avatar size={36} shape="circle" />}
                  onOpen={() => openSettingsTab(`/settings/mcp/${provider.key}`)}
                  action={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('marketplace.configure') + ': ' + getProviderDisplayName(provider, t)}
                      onClick={() => openSettingsTab(`/settings/mcp/${provider.key}`)}>
                      <Settings2 className="size-4" />
                    </Button>
                  }
                />
              )}
            />
          </section>
        ) : null}
        {markets.length ? (
          <section>
            <h2 className="mb-3 text-sm font-medium">{t('settings.mcp.marketplaces')}</h2>
            <MarketplaceGrid
              items={markets.map((market) => ({ ...market, id: market.url }))}
              renderItem={(market) => {
                const Logo = market.logo
                return (
                  <MarketplaceCard
                    name={market.name}
                    description={t(market.descriptionKey)}
                    icon={
                      typeof Logo === 'string' ? (
                        <img src={Logo} alt="" className="size-9 shrink-0 rounded-lg object-contain" />
                      ) : (
                        <Logo.Avatar size={36} shape="circle" />
                      )
                    }
                    onOpen={() => openExternalWebsite(market.url)}
                    action={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('marketplace.open_website') + ': ' + market.name}
                        onClick={() => openExternalWebsite(market.url)}>
                        <ExternalLink className="size-4" />
                      </Button>
                    }
                  />
                )
              }}
            />
          </section>
        ) : null}
      </>
    )
  }
  return (
    <>
      <MarketplaceLoadState
        error={catalog.error}
        empty={!visible.length}
        retry={() => catalog.retry().catch(() => {})}
      />
      <MarketplaceGrid
        items={visible}
        renderItem={(preset) => (
          <MarketplaceCard
            name={preset.name}
            description={description(preset)}
            icon={
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-subtle">
                <Network className="size-5 text-muted-foreground" />
              </span>
            }
            onOpen={(event) => {
              trigger.current = event.currentTarget
              setSelected(preset)
            }}
            action={action(preset)}>
            {catalog.findInstalled(preset) ? (
              <span className="mt-1 block text-xs font-normal text-success">{t('marketplace.added')}</span>
            ) : preset.shouldConfig ? (
              <span className="mt-1 block text-xs font-normal text-foreground-tertiary">
                {t('settings.mcp.requiresConfig')}
              </span>
            ) : null}
          </MarketplaceCard>
        )}
      />
      <Dialog
        open={Boolean(selected) && active}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null)
        }}>
        <MarketplaceDetailContent
          closeOnOverlayClick={!busy}
          onPointerDownOutside={(event) => busy && event.preventDefault()}
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            trigger.current?.focus()
          }}>
          {selected ? (
            <>
              <MarketplaceDetailHeader
                curated
                name={selected.name}
                description={description(selected)}
                type={t('marketplace.type.mcp')}
                icon={
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border-subtle bg-background text-muted-foreground shadow-sm">
                    <Network className="size-7" strokeWidth={1.5} aria-hidden="true" />
                  </span>
                }
              />
              <MarketplaceDetailBody>
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {description(selected)}
                </p>
                {selected.shouldConfig ? <Badge variant="secondary">{t('settings.mcp.requiresConfig')}</Badge> : null}
              </MarketplaceDetailBody>
              <MarketplaceDetailFooter>
                {selected.reference ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={() => openExternalWebsite(selected.reference!)}>
                    <ExternalLink className="size-3.5" />
                    {t('marketplace.open_website')}
                  </Button>
                ) : (
                  <span />
                )}
                {action(selected, true)}
              </MarketplaceDetailFooter>
            </>
          ) : null}
        </MarketplaceDetailContent>
      </Dialog>
    </>
  )
}
