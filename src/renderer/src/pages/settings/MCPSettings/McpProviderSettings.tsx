import { Button, Input } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import Scrollbar from '@renderer/components/Scrollbar'
import db from '@renderer/databases'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPServer } from '@renderer/types'
import { cn } from '@renderer/utils/style'
import { Check, Plus, SquareArrowOutUpRight } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getMCPProviderLogo, getProviderDisplayName, type ProviderConfig } from './providers/config'

const logger = loggerService.withContext('McpProviderSettings')

interface Props {
  provider: ProviderConfig
  existingServers: MCPServer[]
}

const McpProviderSettings: React.FC<Props> = ({ provider, existingServers }) => {
  const { addMCPServer } = useMCPServers()
  const [isFetching, setIsFetching] = useState(false)
  const [token, setToken] = useState<string>('')
  const [availableServers, setAvailableServers] = useState<MCPServer[]>([])
  const [searchText, setSearchText] = useState('')
  const { t } = useTranslation()

  useEffect(() => {
    setToken(provider.getToken() || '')
  }, [provider])

  // Load available servers from database when provider changes
  useEffect(() => {
    const loadServersFromDb = async () => {
      try {
        const dbKey = `mcp:provider:${provider.key}:servers`
        const setting = await db.settings.get(dbKey)
        const savedServers = setting?.value || []
        setAvailableServers(savedServers)
      } catch (error) {
        logger.error('Failed to load servers from database', error as Error)
        setAvailableServers([])
      }
    }

    void loadServersFromDb()
  }, [provider.key])

  // Sort servers: servers with logo first, then by name
  const sortedServers = useMemo(() => {
    return [...availableServers].sort((a, b) => {
      // Servers with logo come first
      if (a.logoUrl && !b.logoUrl) return -1
      if (!a.logoUrl && b.logoUrl) return 1
      // If both have or both don't have logo, sort by name
      return a.name.localeCompare(b.name)
    })
  }, [availableServers])

  // Filter servers based on search text
  const filteredServers = useMemo(() => {
    if (!searchText.trim()) {
      return sortedServers
    }
    const lowerSearchText = searchText.toLowerCase()
    return sortedServers.filter(
      (server) =>
        server.name.toLowerCase().includes(lowerSearchText) ||
        server.description?.toLowerCase().includes(lowerSearchText)
    )
  }, [sortedServers, searchText])

  const handleTokenChange = useCallback(
    (value: string) => {
      setToken(value)
      // Auto-save token when user types
      if (value.trim()) {
        provider.saveToken(value)
      }
    },
    [provider]
  )

  const handleFetch = useCallback(async () => {
    if (!token.trim()) {
      window.toast.error(t('settings.mcp.sync.tokenRequired', 'API Token is required'))
      return
    }

    setIsFetching(true)

    try {
      provider.saveToken(token)
      const result = await provider.syncServers(token, existingServers)

      if (result.success) {
        const servers = result.allServers || []
        setAvailableServers(servers)

        // Save to database
        const dbKey = `mcp:provider:${provider.key}:servers`
        await db.settings.put({ id: dbKey, value: servers })

        window.toast.success(t('settings.mcp.fetch.success', 'Successfully fetched MCP servers'))
      } else {
        window.toast.error(result.message)
      }
    } catch (error: any) {
      logger.error('Failed to fetch MCP servers', error)
      window.toast.error(`${t('settings.mcp.sync.error')}: ${error.message}`)
    } finally {
      setIsFetching(false)
    }
  }, [existingServers, provider, t, token])

  const isFetchDisabled = !token
  const ProviderLogo = getMCPProviderLogo(provider.key)

  return (
    <DetailContainer>
      <ProviderHeader>
        <div className="flex min-w-0 items-center gap-3">
          {ProviderLogo && <ProviderLogo.Avatar size={36} shape="circle" />}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <ProviderName>{getProviderDisplayName(provider, t)}</ProviderName>
              {provider.discoverUrl && (
                <Button
                  asChild
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 rounded-md text-muted-foreground shadow-none hover:text-blue-600 dark:hover:text-blue-400">
                  <a target="_blank" rel="noreferrer" href={provider.discoverUrl}>
                    <SquareArrowOutUpRight size={13} />
                  </a>
                </Button>
              )}
            </div>
            <ProviderDescription>{t(provider.descriptionKey)}</ProviderDescription>
          </div>
        </div>
        <Button
          onClick={handleFetch}
          disabled={isFetching || isFetchDisabled}
          className="h-8 shrink-0 rounded-lg px-3 text-xs shadow-none">
          {t('settings.mcp.fetch.button', 'Fetch Servers')}
        </Button>
      </ProviderHeader>

      <SettingsPanel>
        <div className="mb-2 flex items-center justify-between gap-3">
          <PanelTitle>{t('settings.provider.api_key.label')}</PanelTitle>
        </div>
        <Input
          type="password"
          value={token}
          placeholder={t('settings.mcp.sync.tokenPlaceholder', 'Enter API token here')}
          onChange={(e) => handleTokenChange(e.target.value)}
          spellCheck={false}
          className="h-9 rounded-lg bg-background shadow-none"
        />
        {provider.apiKeyUrl && (
          <a
            target="_blank"
            rel="noreferrer"
            href={provider.apiKeyUrl}
            className="mt-3.5 inline-flex items-center font-medium text-xs hover:underline"
            style={{ color: 'var(--color-blue-600)' }}>
            {t('settings.provider.get_api_key')}
          </a>
        )}
      </SettingsPanel>

      {sortedServers.length > 0 && (
        <SettingsPanel>
          <div className="flex items-center justify-between">
            <PanelTitle>{t('settings.mcp.servers', 'Available MCP Servers')}</PanelTitle>
            <CollapsibleSearchBar
              onSearch={setSearchText}
              placeholder={t('settings.mcp.search.placeholder', 'Search servers...')}
              tooltip={t('settings.mcp.search.tooltip', 'Search servers')}
              maxWidth={200}
              style={{ borderRadius: 20 }}
            />
          </div>
          <ServerList>
            {filteredServers.map((server) => (
              <ServerItem key={server.id}>
                <div className="flex flex-1 flex-row items-center gap-3">
                  {server.logoUrl && (
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800">
                      <img src={server.logoUrl} alt={server.name} className="h-full w-full object-cover" />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <ServerName>{server.name}</ServerName>
                    <ServerDescription>{server.description}</ServerDescription>
                  </div>
                </div>
                {(() => {
                  const isAlreadyAdded = existingServers.some((existing) => existing.id === server.id)
                  return (
                    <Button
                      disabled={isAlreadyAdded}
                      variant="ghost"
                      size="icon-sm"
                      className="ml-2.5 size-7 min-h-7 shadow-none"
                      onClick={async () => {
                        if (!isAlreadyAdded) {
                          try {
                            await addMCPServer(server)
                            window.toast.success(t('settings.mcp.addSuccess'))
                          } catch {
                            window.toast.error(t('settings.mcp.addError'))
                          }
                        }
                      }}>
                      {isAlreadyAdded ? <Check size={12} /> : <Plus size={12} />}
                    </Button>
                  )
                })()}
              </ServerItem>
            ))}
          </ServerList>
        </SettingsPanel>
      )}
    </DetailContainer>
  )
}

const DetailContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Scrollbar>) => (
  <Scrollbar className={cn('flex h-[calc(100vh-var(--navbar-height))] flex-col px-5 py-4', className)} {...props} />
)

const ProviderHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center justify-between gap-3 border-border/70 border-b pb-2', className)} {...props} />
)

const ProviderName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('min-w-0 truncate font-semibold text-base leading-6', className)} {...props} />
)

const ProviderDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-0.5 text-muted-foreground text-xs leading-5', className)} {...props} />
)

const SettingsPanel = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-4', className)} {...props} />
)

const PanelTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('font-semibold text-foreground text-sm', className)} {...props} />
)

const ServerList = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2 flex flex-col gap-2', className)} {...props} />
)

const ServerItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 transition-colors duration-200 ease-in-out hover:border-border hover:bg-muted/35',
      className
    )}
    {...props}
  />
)

const ServerName = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-0.5 font-medium text-sm leading-5', className)} {...props} />
)

const ServerDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('line-clamp-2 text-muted-foreground text-xs leading-5', className)} {...props} />
)

export default McpProviderSettings
