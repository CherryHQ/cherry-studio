import { TopView } from '@renderer/components/TopView'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPServer } from '@renderer/types'
import { Button, Form, Input, Modal, Select } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { getModelScopeToken, saveModelScopeToken, syncModelScopeServers } from './modelscopeSyncUtils'
import { getTokenLanYunToken, LANYUN_KEY_HOST, saveTokenLanYunToken, syncTokenLanYunServers } from './providers/lanyun'
import { getTokenFluxToken, saveTokenFluxToken, syncTokenFluxServers, TOKENFLUX_HOST } from './providers/tokenflux'

// Provider configuration interface
interface ProviderConfig {
  key: string
  name: string
  description: string
  discoverUrl: string
  apiKeyUrl: string
  tokenFieldName: string
  getToken: () => string | null
  saveToken: (token: string) => void
  syncServers: (token: string, existingServers: MCPServer[]) => Promise<any>
}

// Provider configurations
const providers: ProviderConfig[] = [
  {
    key: 'modelscope',
    name: 'ModelScope',
    description: 'ModelScope 平台 MCP 服务',
    discoverUrl: 'https://www.modelscope.cn/mcp?hosted=1&page=1',
    apiKeyUrl: 'https://www.modelscope.cn/my/myaccesstoken',
    tokenFieldName: 'modelScopeToken',
    getToken: getModelScopeToken,
    saveToken: saveModelScopeToken,
    syncServers: syncModelScopeServers
  },
  {
    key: 'tokenflux',
    name: 'TokenFlux',
    description: 'TokenFlux 平台 MCP 服务',
    discoverUrl: `${TOKENFLUX_HOST}/mcps`,
    apiKeyUrl: `${TOKENFLUX_HOST}/dashboard/api-keys`,
    tokenFieldName: 'tokenfluxToken',
    getToken: getTokenFluxToken,
    saveToken: saveTokenFluxToken,
    syncServers: syncTokenFluxServers
  },
  {
    key: 'lanyun',
    name: '蓝耘科技',
    description: '蓝耘科技云平台 MCP 服务',
    discoverUrl: 'https://mcp.lanyun.net',
    apiKeyUrl: LANYUN_KEY_HOST,
    tokenFieldName: 'tokenLanyunToken',
    getToken: getTokenLanYunToken,
    saveToken: saveTokenLanYunToken,
    syncServers: syncTokenLanYunServers
  }
]

interface Props {
  resolve: (data: any) => void
  existingServers: MCPServer[]
}

const PopupContainer: React.FC<Props> = ({ resolve, existingServers }) => {
  const { addMCPServer } = useMCPServers()
  const [open, setOpen] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [selectedProviderKey, setSelectedProviderKey] = useState(providers[0].key)
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const { t } = useTranslation()
  const [form] = Form.useForm()

  // Get the currently selected provider config
  const selectedProvider = providers.find((p) => p.key === selectedProviderKey) || providers[0]

  useEffect(() => {
    // Initialize tokens for all providers
    const initialTokens: Record<string, string> = {}

    providers.forEach((provider) => {
      const token = provider.getToken()
      if (token) {
        initialTokens[provider.tokenFieldName] = token
        form.setFieldsValue({ [provider.tokenFieldName]: token })
      }
    })

    setTokens(initialTokens)
  }, [form])

  const handleSync = useCallback(async () => {
    try {
      await form.validateFields()
    } catch (error) {
      return
    }

    setIsSyncing(true)

    try {
      const token = form.getFieldValue(selectedProvider.tokenFieldName)

      // Save token if present
      if (token) {
        selectedProvider.saveToken(token)
        setTokens((prev) => ({
          ...prev,
          [selectedProvider.tokenFieldName]: token
        }))
      }

      // Sync servers
      const result = await selectedProvider.syncServers(token, existingServers)

      if (result.success && result.addedServers?.length > 0) {
        // Add the new servers to the store
        for (const server of result.addedServers) {
          addMCPServer(server)
        }
        window.message.success(result.message)
        setOpen(false)
      } else {
        // Show message but keep dialog open
        if (result.success) {
          window.message.info(result.message)
        } else {
          window.message.error(result.message)
        }
      }
    } catch (error: any) {
      window.message.error(`${t('settings.mcp.sync.error')}: ${error.message}`)
    } finally {
      setIsSyncing(false)
    }
  }, [addMCPServer, existingServers, form, selectedProvider, t])

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  SyncServersPopup.hide = onCancel

  // Check if sync button should be disabled
  const isSyncDisabled = () => {
    const token = tokens[selectedProvider.tokenFieldName]
    return !token
  }

  return (
    <Modal
      title={t('settings.mcp.sync.title', 'Sync Servers')}
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      width={550}
      footer={null}
      transitionName="animation-move-down"
      centered>
      <ContentContainer>
        {/* Only show provider selector if there are multiple providers */}

        <ProviderSelector>
          <SelectorLabel>{t('settings.mcp.sync.selectProvider', 'Select Provider:')}</SelectorLabel>
          <Select
            value={selectedProviderKey}
            onChange={setSelectedProviderKey}
            style={{ width: 200 }}
            options={providers.map((provider) => ({
              value: provider.key,
              label: provider.name
            }))}
          />
        </ProviderSelector>

        <ProviderContent>
          <Form form={form} layout="vertical" style={{ width: '100%' }}>
            <StepSection>
              <StepNumber>1</StepNumber>
              <StepContent>
                <StepTitle>{t('settings.mcp.sync.discoverMcpServers', 'Discover MCP Servers')}</StepTitle>
                <StepDescription>
                  {t(
                    'settings.mcp.sync.discoverMcpServersDescription',
                    'Visit the platform to discover available MCP servers'
                  )}
                </StepDescription>
                <LinkContainer>
                  <ExternalLink href={selectedProvider.discoverUrl} target="_blank">
                    <LinkIcon>🌐</LinkIcon>
                    <span>{t('settings.mcp.sync.discoverMcpServers', 'Discover MCP Servers')}</span>
                  </ExternalLink>
                </LinkContainer>
              </StepContent>
            </StepSection>

            <StepSection>
              <StepNumber>2</StepNumber>
              <StepContent>
                <StepTitle>{t('settings.mcp.sync.getToken', 'Get API Token')}</StepTitle>
                <StepDescription>
                  {t('settings.mcp.sync.getTokenDescription', 'Retrieve your personal API token from your account')}
                </StepDescription>
                <LinkContainer>
                  <ExternalLink href={selectedProvider.apiKeyUrl} target="_blank">
                    <LinkIcon>🔑</LinkIcon>
                    <span>{t('settings.mcp.sync.getToken', 'Get API Token')}</span>
                  </ExternalLink>
                </LinkContainer>
              </StepContent>
            </StepSection>

            <StepSection>
              <StepNumber>3</StepNumber>
              <StepContent>
                <StepTitle>{t('settings.mcp.sync.setToken', 'Enter Your Token')}</StepTitle>
                <Form.Item
                  name={selectedProvider.tokenFieldName}
                  rules={[
                    {
                      required: true,
                      message: t('settings.mcp.sync.tokenRequired', 'API Token is required')
                    }
                  ]}>
                  <Input.Password
                    placeholder={t('settings.mcp.sync.tokenPlaceholder', 'Enter API token here')}
                    onChange={(e) => {
                      setTokens((prev) => ({
                        ...prev,
                        [selectedProvider.tokenFieldName]: e.target.value
                      }))
                    }}
                  />
                </Form.Item>
              </StepContent>
            </StepSection>
          </Form>
        </ProviderContent>

        <ButtonContainer>
          <Button type="default" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="primary" onClick={handleSync} loading={isSyncing} disabled={isSyncDisabled()}>
            {t('settings.mcp.sync.button', 'Sync')}
          </Button>
        </ButtonContainer>
      </ContentContainer>
    </Modal>
  )
}

const ContentContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const ProviderSelector = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 15px;
`

const SelectorLabel = styled.div`
  font-weight: 500;
  white-space: nowrap;
`

const ProviderContent = styled.div`
  border-top: 1px solid var(--color-border);
  padding-top: 20px;

  &.no-border {
    border-top: none;
    padding-top: 0;
  }
`

const StepSection = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 15px;
  margin-bottom: 20px;
`

const StepNumber = styled.div`
  background-color: var(--color-primary);
  color: white;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 2px;
`

const StepContent = styled.div`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
`

const StepTitle = styled.div`
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 4px;
`

const StepDescription = styled.div`
  color: var(--color-text-secondary);
  font-size: 13px;
  margin-bottom: 8px;
`

const LinkContainer = styled.div`
  margin-top: 4px;
`

const ExternalLink = styled.a`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background-color: var(--color-background-2);
  font-size: 14px;
  color: var(--color-primary);
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--color-background-3);
    text-decoration: none;
  }
`

const LinkIcon = styled.span`
  font-size: 16px;
`

const ButtonContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 15px;
  border-top: 1px solid var(--color-border);
`

const TopViewKey = 'SyncServersPopup'

export default class SyncServersPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(existingServers: MCPServer[]) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          existingServers={existingServers}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
