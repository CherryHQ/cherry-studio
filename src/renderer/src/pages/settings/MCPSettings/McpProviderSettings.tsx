import { Button, Flex, RowFlex } from '@cherrystudio/ui'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPServer } from '@renderer/types'
import { Divider, Input, Space } from 'antd'
import Link from 'antd/es/typography/Link'
import { SquareArrowOutUpRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingHelpLink, SettingHelpTextRow, SettingSubtitle } from '..'
import type { ProviderConfig } from './providers/config'

interface Props {
  provider: ProviderConfig
  existingServers: MCPServer[]
}

const McpProviderSettings: React.FC<Props> = ({ provider, existingServers }) => {
  const { addMCPServer } = useMCPServers()
  const [isFetching, setIsFetching] = useState(false)
  const [token, setToken] = useState<string>('')
  const [availableServers, setAvailableServers] = useState<MCPServer[]>([])
  const { t } = useTranslation()

  useEffect(() => {
    const savedToken = provider.getToken()
    if (savedToken) {
      setToken(savedToken)
    }
  }, [provider])

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
        setAvailableServers(result.addedServers || [])
        window.toast.success(t('settings.mcp.fetch.success', 'Successfully fetched MCP servers'))
      } else {
        window.toast.error(result.message)
      }
    } catch (error: any) {
      window.toast.error(`${t('settings.mcp.sync.error')}: ${error.message}`)
    } finally {
      setIsFetching(false)
    }
  }, [existingServers, provider, t, token])

  const isFetchDisabled = !token

  return (
    <DetailContainer>
      <ProviderHeader>
        <Flex className="items-center gap-2">
          <ProviderName>{provider.name}</ProviderName>
          {provider.discoverUrl && (
            <Link target="_blank" href={provider.discoverUrl} style={{ display: 'flex' }}>
              <Button variant="flat" size="sm">
                <SquareArrowOutUpRight size={14} />
              </Button>
            </Link>
          )}
        </Flex>
        <Button variant="solid" onClick={handleFetch} isLoading={isFetching} isDisabled={isFetchDisabled}>
          {t('settings.mcp.fetch.button', 'Fetch Servers')}
        </Button>
      </ProviderHeader>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.api_key.label')}</SettingSubtitle>
      <Space.Compact style={{ width: '100%', marginTop: 5 }}>
        <Input.Password
          value={token}
          placeholder={t('settings.mcp.sync.tokenPlaceholder', 'Enter API token here')}
          onChange={(e) => setToken(e.target.value)}
          spellCheck={false}
        />
      </Space.Compact>
      <SettingHelpTextRow>
        <RowFlex>
          {provider.apiKeyUrl && (
            <SettingHelpLink target="_blank" href={provider.apiKeyUrl}>
              {t('settings.provider.get_api_key')}
            </SettingHelpLink>
          )}
        </RowFlex>
      </SettingHelpTextRow>

      {availableServers.length > 0 && (
        <>
          <SettingSubtitle style={{ marginTop: 20 }}>
            {t('settings.mcp.available.servers', 'Available MCP Servers')}
          </SettingSubtitle>
          <ServerList>
            {availableServers.map((server) => (
              <ServerItem key={server.id}>
                <ServerInfo>
                  <ServerName>{server.name}</ServerName>
                  <ServerDescription>{server.description}</ServerDescription>
                </ServerInfo>
                {(() => {
                  const isAlreadyAdded = existingServers.some((existing) => existing.id === server.id)
                  return (
                    <Button
                      variant={isAlreadyAdded ? 'bordered' : 'solid'}
                      size="sm"
                      disabled={isAlreadyAdded}
                      onClick={() => {
                        if (!isAlreadyAdded) {
                          addMCPServer(server)
                          window.toast.success(t('settings.mcp.server.added', 'MCP server added'))
                        }
                      }}>
                      {isAlreadyAdded ? t('settings.mcp.server.added', 'Added') : t('settings.mcp.add.server', 'Add')}
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

const DetailContainer = styled.div`
  padding: 20px;
  display: flex;
  flex-direction: column;
`

const ProviderHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
  margin-right: -2px;
`

const ServerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
`

const ServerItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background-color: var(--color-background);
`

const ServerInfo = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`

const ServerName = styled.div`
  font-weight: 500;
  font-size: 14px;
  margin-bottom: 4px;
`

const ServerDescription = styled.div`
  color: var(--color-text-secondary);
  font-size: 12px;
`

export default McpProviderSettings
