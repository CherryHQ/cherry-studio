import { Button, Input, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { getBuiltInMcpServerDescriptionLabel, getMcpTypeLabel } from '@renderer/i18n/label'
import { builtinMCPServers } from '@renderer/store/mcp'
import { cn } from '@renderer/utils/style'
import { Popover, Tag } from 'antd'
import { Check, Plus, Search } from 'lucide-react'
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
  }, [filter, mcpServers, searchText, t])

  return (
    <div className="mb-5">
      <div className="mb-3 flex items-center gap-2">
        <SettingTitle className="m-0">{t('settings.mcp.builtinServers')}</SettingTitle>
        <span className="text-muted-foreground text-sm">
          {installedCount}/{builtinMCPServers.length}
        </span>
      </div>

      <div className="relative mb-3">
        <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
        <Input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder={t('common.search')}
          className="h-9 rounded-full border-transparent bg-background pl-9 shadow-none"
        />
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)} className="mb-3">
        <TabsList className="h-auto rounded-full bg-muted/80 p-0.5">
          <TabsTrigger value="all" className="rounded-full px-2.5 py-1 text-xs">
            {t('models.all')}
          </TabsTrigger>
          <TabsTrigger value="installed" className="rounded-full px-2.5 py-1 text-xs">
            {t('settings.skills.installed')}
          </TabsTrigger>
          <TabsTrigger value="available" className="rounded-full px-2.5 py-1 text-xs">
            {t('settings.skills.install')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-1">
        {filteredServers.map((server) => {
          const isInstalled = mcpServers.some((existingServer) => existingServer.name === server.name)

          return (
            <div
              key={server.id}
              className="flex min-h-18 items-start gap-3 rounded-xl border border-border/60 bg-transparent px-3 py-2.5 transition-colors duration-200 ease-in-out hover:bg-accent">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2 overflow-hidden">
                  <span className="truncate font-semibold text-[15px]">{server.name}</span>
                  <Tag color="warning" style={{ borderRadius: 8, margin: 0, fontWeight: 600 }}>
                    {t('settings.mcp.builtinServers')}
                  </Tag>
                  {server?.shouldConfig && (
                    <a
                      href="https://docs.cherry-ai.com/advanced-basic/mcp/buildin"
                      target="_blank"
                      rel="noopener noreferrer">
                      <Tag color="error" style={{ borderRadius: 8, margin: 0, fontWeight: 600 }}>
                        {t('settings.mcp.requiresConfig')}
                      </Tag>
                    </a>
                  )}
                </div>
                <Popover
                  content={
                    <div className="wrap-break-word max-w-87.5 whitespace-pre-wrap text-[14px] text-foreground leading-normal">
                      {getBuiltInMcpServerDescriptionLabel(server.name)}
                      {server.reference && (
                        <a
                          href={server.reference}
                          className="wrap-break-word mt-2 inline-block max-w-87.5 text-primary no-underline hover:text-primary/80 hover:underline">
                          {server.reference}
                        </a>
                      )}
                    </div>
                  }
                  title={server.name}
                  trigger="hover"
                  placement="topLeft"
                  overlayStyle={{ maxWidth: 400 }}>
                  <div className="line-clamp-2 cursor-pointer text-muted-foreground text-sm leading-5 hover:text-foreground">
                    {getBuiltInMcpServerDescriptionLabel(server.name)}
                  </div>
                </Popover>
                <div className="mt-1.5 flex items-center gap-1">
                  <Tag color="processing" style={{ borderRadius: 8, margin: 0, fontWeight: 500 }}>
                    {getMcpTypeLabel(server.type ?? 'stdio')}
                  </Tag>
                </div>
              </div>
              <div className="ml-3 flex shrink-0 items-center self-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 rounded-full px-3 text-sm shadow-none hover:shadow-none',
                    isInstalled ? 'text-muted-foreground' : 'text-muted-foreground'
                  )}
                  onClick={async () => {
                    if (isInstalled) {
                      return
                    }

                    try {
                      await addMCPServer(server)
                      window.toast.success(t('settings.mcp.addSuccess'))
                    } catch {
                      window.toast.error(t('settings.mcp.addError'))
                    }
                  }}
                  disabled={isInstalled}>
                  {isInstalled ? (
                    <>
                      <Check size={14} className="text-primary" />
                      {t('settings.skills.installed')}
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      {t('settings.skills.install')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default BuiltinMCPServerList
