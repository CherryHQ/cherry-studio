import { useTheme } from '@renderer/context/ThemeProvider'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { useProviders } from '@renderer/hooks/useProvider'
import { getProviderLabel } from '@renderer/i18n/label'
import type { RootState } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import {
  addApiGatewayModelGroup,
  removeApiGatewayModelGroup,
  setApiGatewayEnabledEndpoints,
  setApiGatewayExposeToNetwork,
  setApiServerApiKey,
  setApiServerPort,
  updateApiGatewayModelGroup
} from '@renderer/store/settings'
import type { GatewayEndpoint, ModelGroup } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import { API_SERVER_DEFAULTS } from '@shared/config/constant'
import { validators } from '@shared/utils'
import { Alert, Button, Checkbox, Input, InputNumber, Segmented, Select, Switch, Tooltip, Typography } from 'antd'
import { AlertTriangle, Copy, ExternalLink, Play, Plus, RotateCcw, Square, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'
import { v4 as uuidv4 } from 'uuid'

import { SettingContainer } from '../..'

const { Text, Title } = Typography

const GATEWAY_ENDPOINTS: { value: GatewayEndpoint; labelKey: string }[] = [
  { value: '/v1/chat/completions', labelKey: 'apiGateway.endpoints.chatCompletions' },
  { value: '/v1/messages', labelKey: 'apiGateway.endpoints.messages' }
]

type EnvFormat = 'openai' | 'anthropic'

const ApiServerSettings: FC = () => {
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  // API Gateway state with proper defaults
  const apiServerConfig = useSelector((state: RootState) => state.settings.apiServer)
  const { apiServerRunning, apiServerLoading, startApiServer, stopApiServer, restartApiServer, setApiServerEnabled } =
    useApiServer()

  const handleApiServerToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        await startApiServer()
      } else {
        await stopApiServer()
      }
    } catch (error) {
      window.toast.error(t('apiServer.messages.operationFailed') + formatErrorMessage(error))
    } finally {
      setApiServerEnabled(enabled)
    }
  }

  const handleApiServerRestart = async () => {
    await restartApiServer()
  }

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiServerConfig.apiKey)
    window.toast.success(t('apiServer.messages.apiKeyCopied'))
  }

  const regenerateApiKey = () => {
    const newApiKey = `cs-sk-${uuidv4()}`
    dispatch(setApiServerApiKey(newApiKey))
    window.toast.success(t('apiServer.messages.apiKeyRegenerated'))
  }

  const handlePortChange = (value: string) => {
    const port = parseInt(value) || API_SERVER_DEFAULTS.PORT
    if (port >= 1000 && port <= 65535) {
      dispatch(setApiServerPort(port))
    }
  }

  const handleEndpointsChange = (endpoints: GatewayEndpoint[]) => {
    dispatch(setApiGatewayEnabledEndpoints(endpoints))
  }

  const handleExposeToNetworkChange = (expose: boolean) => {
    dispatch(setApiGatewayExposeToNetwork(expose))
  }

  const openApiDocs = () => {
    if (apiServerRunning) {
      const host = apiServerConfig.host || API_SERVER_DEFAULTS.HOST
      const port = apiServerConfig.port || API_SERVER_DEFAULTS.PORT
      window.open(`http://${host}:${port}/api-docs`, '_blank')
    }
  }

  // Model group management
  const addModelGroup = () => {
    const newGroup: ModelGroup = {
      id: uuidv4().slice(0, 8), // Internal identifier
      name: `group-${apiServerConfig.modelGroups.length + 1}`, // URL-safe name
      providerId: '',
      modelId: '',
      createdAt: Date.now()
    }
    dispatch(addApiGatewayModelGroup(newGroup))
  }

  const updateModelGroup = (group: ModelGroup) => {
    dispatch(updateApiGatewayModelGroup(group))
  }

  const deleteModelGroup = (groupId: string) => {
    dispatch(removeApiGatewayModelGroup(groupId))
  }

  return (
    <Container theme={theme}>
      {/* Header Section */}
      <HeaderSection>
        <HeaderContent>
          <Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            {t('apiGateway.title')}
          </Title>
          <Text type="secondary">{t('apiGateway.description')}</Text>
        </HeaderContent>
        {apiServerRunning && (
          <Button type="primary" icon={<ExternalLink size={14} />} onClick={openApiDocs}>
            {t('apiServer.documentation.title')}
          </Button>
        )}
      </HeaderSection>

      {!apiServerRunning && (
        <Alert type="warning" message={t('agent.warning.enable_server')} style={{ marginBottom: 10 }} showIcon />
      )}

      {/* Server Control Panel with integrated configuration */}
      <ServerControlPanel $status={apiServerRunning}>
        <StatusSection>
          <StatusIndicator $status={apiServerRunning} />
          <StatusContent>
            <StatusText $status={apiServerRunning}>
              {apiServerRunning ? t('apiServer.status.running') : t('apiServer.status.stopped')}
            </StatusText>
            <StatusSubtext>
              {apiServerRunning
                ? `http://${apiServerConfig.host || API_SERVER_DEFAULTS.HOST}:${apiServerConfig.port || API_SERVER_DEFAULTS.PORT}`
                : t('apiServer.fields.port.description')}
            </StatusSubtext>
          </StatusContent>
        </StatusSection>

        <ControlSection>
          {apiServerRunning && (
            <Tooltip title={t('apiServer.actions.restart.tooltip')}>
              <RestartButton
                $loading={apiServerLoading}
                onClick={apiServerLoading ? undefined : handleApiServerRestart}>
                <RotateCcw size={14} />
                <span>{t('apiServer.actions.restart.button')}</span>
              </RestartButton>
            </Tooltip>
          )}

          {/* Port input when server is stopped */}
          {!apiServerRunning && (
            <StyledInputNumber
              value={apiServerConfig.port}
              onChange={(value) => handlePortChange(String(value || API_SERVER_DEFAULTS.PORT))}
              min={1000}
              max={65535}
              disabled={apiServerRunning}
              placeholder={String(API_SERVER_DEFAULTS.PORT)}
              size="middle"
            />
          )}

          <Tooltip title={apiServerRunning ? t('apiServer.actions.stop') : t('apiServer.actions.start')}>
            {apiServerRunning ? (
              <StopButton
                $loading={apiServerLoading}
                onClick={apiServerLoading ? undefined : () => handleApiServerToggle(false)}>
                <Square size={20} style={{ color: 'var(--color-status-error)' }} />
              </StopButton>
            ) : (
              <StartButton
                $loading={apiServerLoading}
                onClick={apiServerLoading ? undefined : () => handleApiServerToggle(true)}>
                <Play size={20} style={{ color: 'var(--color-status-success)' }} />
              </StartButton>
            )}
          </Tooltip>
        </ControlSection>
      </ServerControlPanel>

      {/* API Key Configuration - moved to top */}
      <ConfigurationField>
        <FieldLabel>{t('apiServer.fields.apiKey.label')}</FieldLabel>
        <FieldDescription>{t('apiServer.fields.apiKey.description')}</FieldDescription>

        <StyledInput
          value={apiServerConfig.apiKey}
          readOnly
          placeholder={t('apiServer.fields.apiKey.placeholder')}
          size="middle"
          suffix={
            <InputButtonContainer>
              {!apiServerRunning && (
                <RegenerateButton onClick={regenerateApiKey} disabled={apiServerRunning} type="link">
                  {t('apiServer.actions.regenerate')}
                </RegenerateButton>
              )}
              <Tooltip title={t('apiServer.fields.apiKey.copyTooltip')}>
                <InputButton icon={<Copy size={14} />} onClick={copyApiKey} disabled={!apiServerConfig.apiKey} />
              </Tooltip>
            </InputButtonContainer>
          }
        />
      </ConfigurationField>

      {/* Enabled Endpoints - moved before Model Groups */}
      <ConfigurationField>
        <FieldLabel>{t('apiGateway.fields.enabledEndpoints.label')}</FieldLabel>
        <FieldDescription>{t('apiGateway.fields.enabledEndpoints.description')}</FieldDescription>

        <Checkbox.Group
          value={apiServerConfig.enabledEndpoints}
          onChange={(values) => handleEndpointsChange(values as GatewayEndpoint[])}>
          <EndpointList>
            {GATEWAY_ENDPOINTS.map((endpoint) => (
              <Checkbox key={endpoint.value} value={endpoint.value}>
                <EndpointLabel>
                  <code>{endpoint.value}</code>
                  <EndpointDescription>{t(endpoint.labelKey)}</EndpointDescription>
                </EndpointLabel>
              </Checkbox>
            ))}
          </EndpointList>
        </Checkbox.Group>
      </ConfigurationField>

      {/* Model Groups Section */}
      <ConfigurationField>
        <FieldHeader>
          <div>
            <FieldLabel>{t('apiGateway.fields.modelGroups.label')}</FieldLabel>
            <FieldDescription>{t('apiGateway.fields.modelGroups.description')}</FieldDescription>
          </div>
          <Button type="primary" icon={<Plus size={14} />} onClick={addModelGroup}>
            {t('apiGateway.actions.addGroup')}
          </Button>
        </FieldHeader>

        {apiServerConfig.modelGroups.length === 0 ? (
          <EmptyState>
            <Text type="secondary">{t('apiGateway.fields.modelGroups.empty')}</Text>
          </EmptyState>
        ) : (
          <ModelGroupList>
            {apiServerConfig.modelGroups.map((group) => (
              <ModelGroupCard key={group.id} group={group} onUpdate={updateModelGroup} onDelete={deleteModelGroup} />
            ))}
          </ModelGroupList>
        )}
      </ConfigurationField>

      {/* Network Access */}
      <ConfigurationField>
        <NetworkAccessRow>
          <div>
            <FieldLabel>{t('apiGateway.fields.networkAccess.label')}</FieldLabel>
            <FieldDescription>{t('apiGateway.fields.networkAccess.description')}</FieldDescription>
          </div>
          <Switch checked={apiServerConfig.exposeToNetwork} onChange={handleExposeToNetworkChange} />
        </NetworkAccessRow>
        {apiServerConfig.exposeToNetwork && (
          <WarningBox>
            <AlertTriangle size={16} />
            <span>{t('apiGateway.fields.networkAccess.warning')}</span>
          </WarningBox>
        )}
      </ConfigurationField>
    </Container>
  )
}

// Model Group Card Component
interface ModelGroupCardProps {
  group: ModelGroup
  onUpdate: (group: ModelGroup) => void
  onDelete: (groupId: string) => void
}

const ModelGroupCard: FC<ModelGroupCardProps> = ({ group, onUpdate, onDelete }) => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const apiServerConfig = useSelector((state: RootState) => state.settings.apiServer)
  const [envFormat, setEnvFormat] = useState<EnvFormat>('openai')

  // In-place edit for group name (which is also the URL path)
  const { isEditing, startEdit, inputProps, validationError } = useInPlaceEdit({
    onSave: async (name) => {
      // Check for duplicate name
      const isDuplicate = apiServerConfig.modelGroups.some((g) => g.name === name && g.id !== group.id)
      if (isDuplicate) {
        throw new Error(t('apiGateway.messages.nameDuplicate'))
      }

      onUpdate({ ...group, name })
      window.toast.success(t('apiGateway.messages.nameUpdated'))
    },
    validator: validators.urlSafe(32),
    onError: (error) => {
      window.toast.error(error instanceof Error ? error.message : String(error))
    }
  })

  const selectedProvider = useMemo(() => {
    return providers.find((p) => p.id === group.providerId)
  }, [providers, group.providerId])

  const models = useMemo(() => {
    return selectedProvider?.models || []
  }, [selectedProvider])

  const getBaseUrl = () => {
    const host = apiServerConfig.exposeToNetwork ? '0.0.0.0' : apiServerConfig.host || API_SERVER_DEFAULTS.HOST
    const port = apiServerConfig.port || API_SERVER_DEFAULTS.PORT
    return `http://${host}:${port}`
  }

  const getGroupUrl = () => {
    return `${getBaseUrl()}/${group.name}`
  }

  // Get full endpoint URL based on selected format
  const getFullEndpointUrl = () => {
    const baseUrl = getGroupUrl()
    const endpoint = envFormat === 'openai' ? '/v1/chat/completions' : '/v1/messages'
    return `${baseUrl}${endpoint}`
  }

  const copyBaseUrl = () => {
    navigator.clipboard.writeText(getGroupUrl())
    window.toast.success(t('apiGateway.messages.baseUrlCopied'))
  }

  const copyGroupEnvVars = () => {
    const baseUrl = getGroupUrl()
    const apiKey = apiServerConfig.apiKey
    const prefix = envFormat === 'anthropic' ? 'ANTHROPIC' : 'OPENAI'
    // OpenAI SDK expects /v1 in the base URL, Anthropic doesn't
    const urlSuffix = envFormat === 'openai' ? '/v1' : ''
    const envVars = `export ${prefix}_BASE_URL=${baseUrl}${urlSuffix}\nexport ${prefix}_API_KEY=${apiKey}`
    navigator.clipboard.writeText(envVars)
    window.toast.success(t('apiGateway.messages.envVarsCopied'))
  }

  const handleProviderChange = (providerId: string | null) => {
    onUpdate({
      ...group,
      providerId: providerId || '',
      modelId: '' // Clear model when provider changes
    })
  }

  const handleModelChange = (modelId: string | null) => {
    onUpdate({
      ...group,
      modelId: modelId || ''
    })
  }

  const isConfigured = group.providerId && group.modelId

  return (
    <GroupCard $configured={!!isConfigured}>
      <GroupHeader>
        <GroupHeaderLeft>
          {!isEditing ? (
            <GroupPathDisplay onClick={() => startEdit(group.name)}>/{group.name || '...'}</GroupPathDisplay>
          ) : (
            <GroupNameInputWrapper>
              <GroupNameInput
                value={inputProps.value}
                onChange={inputProps.onChange}
                onKeyDown={inputProps.onKeyDown}
                onBlur={inputProps.onBlur}
                disabled={inputProps.disabled}
                placeholder="group-name"
                autoFocus
                prefix={<Text type="secondary">/</Text>}
                status={validationError ? 'error' : undefined}
              />
              {validationError && <ValidationError>{validationError}</ValidationError>}
            </GroupNameInputWrapper>
          )}
        </GroupHeaderLeft>
        <Button type="text" danger icon={<Trash2 size={14} />} onClick={() => onDelete(group.id)} />
      </GroupHeader>

      <GroupContent>
        <SelectRow>
          <StyledSelect
            value={group.providerId || undefined}
            onChange={(value) => handleProviderChange((value as string) || null)}
            placeholder={t('apiGateway.fields.defaultModel.providerPlaceholder')}
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ flex: 1 }}
            options={providers.map((p) => ({
              value: p.id,
              label: p.isSystem ? getProviderLabel(p.id) : p.name
            }))}
          />
          <StyledSelect
            value={group.modelId || undefined}
            onChange={(value) => handleModelChange((value as string) || null)}
            placeholder={t('apiGateway.fields.defaultModel.modelPlaceholder')}
            allowClear
            showSearch
            optionFilterProp="label"
            disabled={!group.providerId}
            style={{ flex: 1 }}
            options={models.map((m) => ({
              value: m.id,
              label: m.name || m.id
            }))}
          />
        </SelectRow>

        {isConfigured && (
          <GroupUrlSection>
            <ButtonGroup>
              <Segmented
                size="small"
                value={envFormat}
                onChange={(value) => setEnvFormat(value as EnvFormat)}
                options={[
                  { label: 'OpenAI', value: 'openai' },
                  { label: 'Anthropic', value: 'anthropic' }
                ]}
              />
            </ButtonGroup>
            <EndpointUrlRow>
              <UrlDisplay>
                <code>{getFullEndpointUrl()}</code>
              </UrlDisplay>
              <Tooltip title={t('apiGateway.fields.baseUrl.copyTooltip')}>
                <Button size="small" type="text" icon={<Copy size={12} />} onClick={copyBaseUrl} />
              </Tooltip>
            </EndpointUrlRow>
            <Tooltip title={t('apiGateway.actions.copyEnvVars')}>
              <Button size="small" icon={<Copy size={12} />} onClick={copyGroupEnvVars}>
                {t('apiGateway.actions.copyEnvVars')}
              </Button>
            </Tooltip>
          </GroupUrlSection>
        )}
      </GroupContent>
    </GroupCard>
  )
}

// Styled Components
const Container = styled(SettingContainer)`
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
  overflow-y: auto;
  gap: 16px;
`

const HeaderSection = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`

const HeaderContent = styled.div`
  flex: 1;
`

const ServerControlPanel = styled.div<{ $status: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-radius: 8px;
  background: var(--color-background);
  border: 1px solid ${(props) => (props.$status ? 'var(--color-status-success)' : 'var(--color-border)')};
  transition: all 0.3s ease;
`

const StatusSection = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const StatusIndicator = styled.div<{ $status: boolean }>`
  position: relative;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${(props) => (props.$status ? 'var(--color-status-success)' : 'var(--color-status-error)')};

  &::before {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    background: ${(props) => (props.$status ? 'var(--color-status-success)' : 'var(--color-status-error)')};
    opacity: 0.2;
    animation: ${(props) => (props.$status ? 'pulse 2s infinite' : 'none')};
  }

  @keyframes pulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.2;
    }
    50% {
      transform: scale(1.5);
      opacity: 0.1;
    }
  }
`

const StatusContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const StatusText = styled.div<{ $status: boolean }>`
  font-weight: 600;
  font-size: 14px;
  color: ${(props) => (props.$status ? 'var(--color-status-success)' : 'var(--color-text-1)')};
  margin: 0;
`

const StatusSubtext = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  margin: 0;
`

const ControlSection = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const RestartButton = styled.div<{ $loading: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-2);
  cursor: ${(props) => (props.$loading ? 'not-allowed' : 'pointer')};
  opacity: ${(props) => (props.$loading ? 0.5 : 1)};
  font-size: 12px;
  transition: all 0.2s ease;

  &:hover {
    color: ${(props) => (props.$loading ? 'var(--color-text-2)' : 'var(--color-primary)')};
  }
`

const StyledInputNumber = styled(InputNumber)`
  width: 80px;
  border-radius: 6px;
  border: 1.5px solid var(--color-border);
  margin-right: 5px;
`

const StartButton = styled.div<{ $loading: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: ${(props) => (props.$loading ? 'not-allowed' : 'pointer')};
  opacity: ${(props) => (props.$loading ? 0.5 : 1)};
  transition: all 0.2s ease;

  &:hover {
    transform: ${(props) => (props.$loading ? 'scale(1)' : 'scale(1.1)')};
  }
`

const StopButton = styled.div<{ $loading: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: ${(props) => (props.$loading ? 'not-allowed' : 'pointer')};
  opacity: ${(props) => (props.$loading ? 0.5 : 1)};
  transition: all 0.2s ease;

  &:hover {
    transform: ${(props) => (props.$loading ? 'scale(1)' : 'scale(1.1)')};
  }
`

const ConfigurationField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: var(--color-background);
  border-radius: 8px;
  border: 1px solid var(--color-border);
`

const FieldHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
`

const FieldLabel = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
  margin: 0;
`

const FieldDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  margin: 0;
`

const StyledInput = styled(Input)`
  width: 100%;
  border-radius: 6px;
  border: 1.5px solid var(--color-border);
`

const StyledSelect = styled(Select)`
  min-width: 180px;
`

const SelectRow = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
`

const InputButtonContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const InputButton = styled(Button)`
  border: none;
  padding: 0 4px;
  background: transparent;
`

const RegenerateButton = styled(Button)`
  padding: 0 4px;
  font-size: 12px;
  height: auto;
  line-height: 1;
  border: none;
  background: transparent;
`

const EndpointList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
`

const EndpointLabel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  code {
    font-family: monospace;
    font-size: 13px;
  }
`

const EndpointDescription = styled.span`
  font-size: 12px;
  color: var(--color-text-3);
`

const NetworkAccessRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const WarningBox = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 6px;
  color: var(--color-warning);
  font-size: 12px;
  margin-top: 8px;
`

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--color-background-soft);
  border-radius: 6px;
  border: 1px dashed var(--color-border);
`

const ModelGroupList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const GroupCard = styled.div<{ $configured: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--color-background-soft);
  border-radius: 8px;
  border: 1px solid ${(props) => (props.$configured ? 'var(--color-primary)' : 'var(--color-border)')};
  transition: border-color 0.2s ease;
`

const GroupHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const GroupHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const GroupNameInputWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const GroupNameInput = styled(Input)`
  font-weight: 500;
  font-size: 14px;
  max-width: 150px;
`

const ValidationError = styled(Text).attrs({ type: 'danger' })`
  font-size: 12px;
`

const GroupPathDisplay = styled.div`
  font-family: monospace;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-2);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--color-background-soft);
    color: var(--color-text-1);
  }
`

const GroupContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const GroupUrlSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
`

const EndpointUrlRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const UrlDisplay = styled.div`
  flex: 1;
  padding: 6px 10px;
  background: var(--color-background);
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-2);
  overflow-x: auto;
`

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`

export default ApiServerSettings
