import { CheckOutlined, PlusOutlined } from '@ant-design/icons'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { getMcpTypeLabel } from '@renderer/i18n/label'
import { builtinMCPServers } from '@renderer/store/mcp'
import { Button, Popover, Tag } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingTitle } from '..'

const BuiltinMCPServersSection: FC = () => {
  const { t } = useTranslation()
  const { addMCPServer, mcpServers } = useMCPServers()

  return (
    <>
      <SettingTitle style={{ gap: 3 }}>{t('settings.mcp.builtinServers')}</SettingTitle>
      <ServersGrid>
        {builtinMCPServers.map((server) => {
          const isInstalled = mcpServers.some((existingServer) => existingServer.name === server.name)

          return (
            <ServerCard key={server.id}>
              <ServerHeader>
                <ServerName>
                  <ServerNameText>{server.name}</ServerNameText>
                </ServerName>
                <StatusIndicator>
                  <Button
                    type="text"
                    icon={isInstalled ? <CheckOutlined style={{ color: 'var(--color-primary)' }} /> : <PlusOutlined />}
                    size="small"
                    onClick={() => {
                      if (isInstalled) {
                        return
                      }

                      addMCPServer(server)
                      window.message.success({ content: t('settings.mcp.addSuccess'), key: 'mcp-add-builtin-server' })
                    }}
                    disabled={isInstalled}
                  />
                </StatusIndicator>
              </ServerHeader>
              <Popover
                content={<PopoverContent>{server.description}</PopoverContent>}
                title={server.name}
                trigger="hover"
                placement="topLeft"
                overlayStyle={{ maxWidth: 400 }}>
                <ServerDescription>
                  {server.description}
                  <MoreIndicator>...</MoreIndicator>
                </ServerDescription>
              </Popover>
              <ServerFooter>
                <Tag color="processing" style={{ borderRadius: 20, margin: 0, fontWeight: 500 }}>
                  {getMcpTypeLabel(server.type ?? 'stdio')}
                </Tag>
                {server.env && Object.keys(server.env).length > 0 && (
                  <Tag color="warning" style={{ borderRadius: 20, margin: 0, fontWeight: 500 }}>
                    {t('settings.mcp.requiresConfig')}
                  </Tag>
                )}
              </ServerFooter>
            </ServerCard>
          )
        })}
      </ServersGrid>
    </>
  )
}

const ServersGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
`

const ServerCard = styled.div`
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--color-border);
  border-radius: var(--list-item-border-radius);
  padding: 10px 16px;
  transition: all 0.2s ease;
  background-color: var(--color-background);
  height: 125px;
  cursor: default;

  &:hover {
    border-color: var(--color-primary);
  }
`

const ServerHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 5px;
`

const ServerName = styled.div`
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 4px;
`

const ServerNameText = styled.span`
  font-size: 15px;
  font-weight: 500;
`

const StatusIndicator = styled.div`
  margin-left: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const ServerDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  width: 100%;
  word-break: break-word;
  height: 50px;
  cursor: pointer;
  position: relative;

  &:hover {
    color: var(--color-text-1);
  }
`

const MoreIndicator = styled.span`
  position: absolute;
  bottom: 0;
  right: 0;
  background: var(--color-background);
  color: var(--color-primary);
  font-weight: 500;
  padding-left: 8px;
`

const PopoverContent = styled.div`
  max-width: 350px;
  line-height: 1.5;
  font-size: 14px;
  color: var(--color-text-1);
  white-space: pre-wrap;
  word-break: break-word;
`

const ServerFooter = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-start;
  margin-top: 10px;
`

export default BuiltinMCPServersSection
