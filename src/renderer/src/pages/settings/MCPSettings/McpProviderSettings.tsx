import { Button, Divider } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import Scrollbar from '@renderer/components/Scrollbar'
import db from '@renderer/databases'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPServer } from '@renderer/types'
import { cn } from '@renderer/utils/style'
import { Flex, Input, Space } from 'antd'
import Link from 'antd/es/typography/Link'
import { Check, Plus, SquareArrowOutUpRight } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpTextRow, SettingSubtitle } from '..'
import { getProviderDisplayName, type ProviderConfig } from './providers/config'

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

  return (
    <DetailContainer>
      <ProviderHeader>
        <Flex className="items-center">
          <ProviderName>{getProviderDisplayName(provider, t)}</ProviderName>
          {provider.discoverUrl && (
            <Link target="_blank" href={provider.discoverUrl} style={{ display: 'flex' }}>
              <Button variant="ghost" size="icon-sm">
                <SquareArrowOutUpRight size={14} />
              </Button>
            </Link>
          )}
        </Flex>
        <Button onClick={handleFetch} disabled={isFetching || isFetchDisabled}>
          {t('settings.mcp.fetch.button', 'Fetch Servers')}
        </Button>
      </ProviderHeader>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.api_key.label')}</SettingSubtitle>
      <Space.Compact style={{ width: '100%', marginTop: 5 }}>
        <Input.Password
          value={token}
          placeholder={t('settings.mcp.sync.tokenPlaceholder', 'Enter API token here')}
          onChange={(e) => handleTokenChange(e.target.value)}
          spellCheck={false}
        />
      </Space.Compact>
      <SettingHelpTextRow>
        <Flex dir="row">
          {provider.apiKeyUrl && (
            <SettingHelpLink target="_blank" href={provider.apiKeyUrl}>
              {t('settings.provider.get_api_key')}
            </SettingHelpLink>
          )}
        </Flex>
      </SettingHelpTextRow>

      {sortedServers.length > 0 && (
        <>
          <Flex justify="space-between" align="center" style={{ marginTop: 20 }}>
            <SettingSubtitle style={{ margin: 0 }}>
              {t('settings.mcp.servers', 'Available MCP Servers')}
            </SettingSubtitle>
            <CollapsibleSearchBar
              onSearch={setSearchText}
              placeholder={t('settings.mcp.search.placeholder', 'Search servers...')}
              tooltip={t('settings.mcp.search.tooltip', 'Search servers')}
              maxWidth={200}
              style={{ borderRadius: 20 }}
            />
          </Flex>
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
                      size="icon-sm"
                      className="ml-2.5 size-7 min-h-7"
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
        </>
      )}
    </DetailContainer>
  )
}

const DetailContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Scrollbar>) => (
  <Scrollbar className={cn('flex h-[calc(100vh-var(--navbar-height))] flex-col p-5', className)} {...props} />
)

const ProviderHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center justify-between', className)} {...props} />
)

const ProviderName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('mr-[-2px] font-medium text-sm', className)} {...props} />
)

const ServerList = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2 flex flex-col gap-2', className)} {...props} />
)

const ServerItem = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex items-center justify-between rounded-lg border border-transparent bg-transparent px-4 py-3 transition-colors hover:bg-accent',
      className
    )}
    {...props}
  />
)

const ServerName = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-1 font-medium text-sm', className)} {...props} />
)

const ServerDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('text-foreground-secondary text-xs', className)} {...props} />
)

export default McpProviderSettings
