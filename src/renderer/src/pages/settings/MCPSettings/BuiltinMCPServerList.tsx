import { Badge, Button, Popover, PopoverContent, PopoverTrigger, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { getBuiltInMcpServerDescriptionLabel } from '@renderer/i18n/label'
import { builtinMCPServers } from '@renderer/store/mcp'
import { cn } from '@renderer/utils/style'
import { Check, Plus } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '..'

const BuiltinMCPServerList: FC = () => {
  const { t } = useTranslation()
  const { addMCPServer, mcpServers } = useMCPServers()
  const [searchText, setSearchText] = useState('')
  const [filter, setFilter] = useState<'all' | 'installed' | 'available'>('all')

  const installedCount = useMemo(
    () =>
      builtinMCPServers.filter((server) => mcpServers.some((existingServer) => existingServer.name === server.name))
        .length,
    [mcpServers]
  )

  const filteredServers = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()

    return builtinMCPServers.filter((server) => {
      const isInstalled = mcpServers.some((existingServer) => existingServer.name === server.name)

      if (filter === 'installed' && !isInstalled) return false
      if (filter === 'available' && isInstalled) return false

      if (!keyword) return true

      const description = getBuiltInMcpServerDescriptionLabel(server.name).toLowerCase()
      return server.name.toLowerCase().includes(keyword) || description.includes(keyword)
    })
  }, [filter, mcpServers, searchText])

  return (
    <div className="mb-5">
      <div className="mb-3 flex items-center gap-2">
        <SettingTitle className="m-0">{t('settings.mcp.builtinServers')}</SettingTitle>
        <span className="text-muted-foreground text-sm">
          {installedCount}/{builtinMCPServers.length}
        </span>
      </div>

      <div className="mb-3 flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)} className="min-w-0">
          <TabsList className="h-8 rounded-full bg-muted/70 p-0.5">
            <TabsTrigger value="all" className="h-7 rounded-[14px] px-2.5 text-xs">
              {t('models.all')}
            </TabsTrigger>
            <TabsTrigger value="installed" className="h-7 rounded-[14px] px-2.5 text-xs">
              {t('settings.skills.installed')}
            </TabsTrigger>
            <TabsTrigger value="available" className="h-7 rounded-[14px] px-2.5 text-xs">
              {t('settings.skills.install')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="min-w-0">
          <CollapsibleSearchBar
            onSearch={setSearchText}
            placeholder={t('settings.mcp.search.placeholder')}
            tooltip={t('settings.mcp.search.tooltip')}
            maxWidth={200}
            style={{ borderRadius: 16 }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {filteredServers.map((server) => {
          const isInstalled = mcpServers.some((existingServer) => existingServer.name === server.name)

          return (
            <div
              key={server.id}
              className={cn(
                'group flex min-h-16 items-center gap-3 rounded-lg border border-border/60 px-3.5 py-2 transition-colors duration-200 ease-in-out hover:border-border hover:bg-muted/35',
                isInstalled && 'bg-muted/25'
              )}>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 overflow-hidden">
                  <span className="truncate font-semibold text-[14px] leading-5">{server.name}</span>
                  {server?.shouldConfig && (
                    <a
                      href="https://docs.cherry-ai.com/advanced-basic/mcp/buildin"
                      target="_blank"
                      rel="noopener noreferrer">
                      <Badge
                        variant="outline"
                        className="h-5 rounded-md border-destructive/25 bg-destructive/10 px-1.5 font-medium text-[11px] text-destructive leading-none">
                        {t('settings.mcp.requiresConfig')}
                      </Badge>
                    </a>
                  )}
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <div className="line-clamp-2 cursor-pointer text-[13px] text-muted-foreground leading-5 transition-colors hover:text-foreground">
                      {getBuiltInMcpServerDescriptionLabel(server.name)}
                    </div>
                  </PopoverTrigger>
                  <PopoverContent align="start" side="top" className="w-auto max-w-100">
                    <div className="mb-2 font-semibold text-foreground text-sm">{server.name}</div>
                    <div className="wrap-break-word whitespace-pre-wrap text-[14px] text-foreground leading-normal">
                      {getBuiltInMcpServerDescriptionLabel(server.name)}
                      {server.reference && (
                        <a
                          href={server.reference}
                          className="wrap-break-word mt-2 inline-block text-primary hover:underline">
                          {server.reference}
                        </a>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="ml-3 flex min-w-[86px] shrink-0 items-center justify-end self-center">
                {isInstalled ? (
                  <div className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-muted-foreground text-xs">
                    <Check size={13} className="text-success/75" />
                    {t('settings.skills.installed')}
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-lg px-2 text-muted-foreground text-xs shadow-none hover:bg-muted hover:text-foreground hover:shadow-none"
                    onClick={async () => {
                      try {
                        await addMCPServer(server)
                        window.toast.success(t('settings.mcp.addSuccess'))
                      } catch {
                        window.toast.error(t('settings.mcp.addError'))
                      }
                    }}>
                    <Plus size={13} />
                    {t('settings.skills.install')}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default BuiltinMCPServerList
