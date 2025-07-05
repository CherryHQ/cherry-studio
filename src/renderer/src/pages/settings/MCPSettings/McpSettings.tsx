import { DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServer, useMCPServers } from '@renderer/hooks/useMCPServers'
import MCPDescription from '@renderer/pages/settings/MCPSettings/McpDescription'
import { MCPPrompt, MCPResource, MCPServer, MCPTool } from '@renderer/types'
import { formatMcpError } from '@renderer/utils/error'
import { Button, Flex, Form, Input, Radio, Select, Switch, Tabs } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { ChevronDown } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '..'
import MCPPromptsSection from './McpPrompt'
import MCPResourcesSection from './McpResource'
import MCPToolsSection from './McpTool'

interface MCPFormValues {
  name: string
  description?: string
  serverType: MCPServer['type']
  baseUrl?: string
  command?: string
  registryUrl?: string
  args?: string
  env?: string
  isActive: boolean
  headers?: string
  timeout?: number

  provider?: string
  providerUrl?: string
  logoUrl?: string
  tags?: string[]
}

interface Registry {
  name: string
  url: string
}

const NpmRegistry: Registry[] = [
  { name: '淘宝 NPM Mirror', url: 'https://registry.npmmirror.com' },
  { name: '自定义', url: 'custom' }
]
const PipRegistry: Registry[] = [
  { name: '清华大学', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { name: '阿里云', url: 'http://mirrors.aliyun.com/pypi/simple/' },
  { name: '中国科学技术大学', url: 'https://mirrors.ustc.edu.cn/pypi/simple/' },
  { name: '华为云', url: 'https://repo.huaweicloud.com/repository/pypi/simple/' },
  { name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/pypi/simple/' }
]

type TabKey = 'settings' | 'description' | 'tools' | 'prompts' | 'resources'

const parseKeyValueString = (str: string): Record<string, string> => {
  const result: Record<string, string> = {}
  str.split('\n').forEach((line) => {
    if (line.trim()) {
      const [key, ...value] = line.split('=')
      const formatValue = value.join('=').trim()
      const formatKey = key.trim()
      if (formatKey && formatValue) {
        result[formatKey] = formatValue
      }
    }
  })
  return result
}

const McpSettings: React.FC = () => {
  const { t } = useTranslation()
  const {
    server: { id: serverId }
  } = useLocation().state as { server: MCPServer }
  const server = useMCPServer(serverId).server as MCPServer
  const { deleteMCPServer, updateMCPServer } = useMCPServers()
  const [serverType, setServerType] = useState<MCPServer['type']>('stdio')
  const [form] = Form.useForm<MCPFormValues>()
  const [loading, setLoading] = useState(false)
  const [isFormChanged, setIsFormChanged] = useState(false)
  const [loadingServer, setLoadingServer] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('settings')

  const [tools, setTools] = useState<MCPTool[]>([])
  const [prompts, setPrompts] = useState<MCPPrompt[]>([])
  const [resources, setResources] = useState<MCPResource[]>([])
  const [isShowRegistry, setIsShowRegistry] = useState(false)
  const [registry, setRegistry] = useState<Registry[]>()
  const [customRegistryUrl, setCustomRegistryUrl] = useState('')
  const [selectedRegistryType, setSelectedRegistryType] = useState<string>('')

  const [showAdvanced, setShowAdvanced] = useState(false)

  const { theme } = useTheme()

  const navigate = useNavigate()

  // Initialize form values whenever the server changes
  useEffect(() => {
    const serverType: MCPServer['type'] = server.type || (server.baseUrl ? 'sse' : 'stdio')
    setServerType(serverType)

    // Set registry UI state based on command and registryUrl
    if (server.command) {
      handleCommandChange(server.command)

      // If there's a registryUrl, ensure registry UI is shown
      if (server.registryUrl) {
        setIsShowRegistry(true)

        // Determine registry type based on command
        let currentRegistry: Registry[] = []
        if (server.command.includes('uv') || server.command.includes('uvx')) {
          currentRegistry = PipRegistry
          setRegistry(PipRegistry)
        } else if (
          server.command.includes('npx') ||
          server.command.includes('bun') ||
          server.command.includes('bunx')
        ) {
          currentRegistry = NpmRegistry
          setRegistry(NpmRegistry)
        }

        // Check if the registryUrl is a custom URL (not in the predefined list)
        const isCustomRegistry =
          currentRegistry.length > 0 &&
          !currentRegistry.some((reg) => reg.url === server.registryUrl) &&
          server.registryUrl !== '' // empty string is default

        if (isCustomRegistry) {
          // Set custom registry state
          setSelectedRegistryType('custom')
          setCustomRegistryUrl(server.registryUrl)
        } else {
          // Reset custom registry state for predefined registries
          setSelectedRegistryType('')
          setCustomRegistryUrl('')
        }
      }
    }

    // Initialize basic fields
    form.setFieldsValue({
      name: server.name,
      description: server.description,
      serverType: serverType,
      baseUrl: server.baseUrl || '',
      command: server.command || '',
      registryUrl: server.registryUrl || '',
      isActive: server.isActive,
      timeout: server.timeout,
      args: server.args ? server.args.join('\n') : '',
      env: server.env
        ? Object.entries(server.env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : '',
      headers: server.headers
        ? Object.entries(server.headers)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : ''
    })

    // Initialize advanced fields separately to ensure they're captured
    // even if the Collapse panel is closed
    form.setFieldsValue({
      provider: server.provider || '',
      providerUrl: server.providerUrl || '',
      logoUrl: server.logoUrl || '',
      tags: server.tags || []
    })
  }, [server, form])

  // Watch for serverType changes
  useEffect(() => {
    const currentServerType = form.getFieldValue('serverType')
    if (currentServerType) {
      setServerType(currentServerType)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.getFieldValue('serverType')])

  const fetchTools = async () => {
    if (server.isActive) {
      try {
        setLoadingServer(server.id)
        const localTools = await window.api.mcp.listTools(server)
        setTools(localTools)
      } catch (error) {
        setLoadingServer(server.id)
      } finally {
        setLoadingServer(null)
      }
    }
  }

  const fetchPrompts = async () => {
    if (server.isActive) {
      try {
        setLoadingServer(server.id)
        const localPrompts = await window.api.mcp.listPrompts(server)
        setPrompts(localPrompts)
      } catch (error) {
        setPrompts([])
      } finally {
        setLoadingServer(null)
      }
    }
  }

  const fetchResources = async () => {
    if (server.isActive) {
      try {
        setLoadingServer(server.id)
        const localResources = await window.api.mcp.listResources(server)
        setResources(localResources)
      } catch (error) {
        setResources([])
      } finally {
        setLoadingServer(null)
      }
    }
  }

  useEffect(() => {
    if (server.isActive) {
      fetchTools()
      fetchPrompts()
      fetchResources()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.isActive])

  useEffect(() => {
    setIsFormChanged(false)
  }, [server.id])

  // Save the form data
  const onSave = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()

      // set basic fields
      const mcpServer: MCPServer = {
        id: server.id,
        name: values.name,
        type: values.serverType || server.type,
        description: values.description,
        isActive: values.isActive,
        registryUrl: values.registryUrl,
        searchKey: server.searchKey,
        timeout: values.timeout || server.timeout,
        // Preserve existing advanced properties if not set in the form
        provider: values.provider || server.provider,
        providerUrl: values.providerUrl || server.providerUrl,
        logoUrl: values.logoUrl || server.logoUrl,
        tags: values.tags || server.tags
      }

      // set stdio or sse server
      if (values.serverType === 'sse' || values.serverType === 'streamableHttp') {
        mcpServer.baseUrl = values.baseUrl
      } else {
        mcpServer.command = values.command
        mcpServer.args = values.args ? values.args.split('\n').filter((arg) => arg.trim() !== '') : []
      }

      // set env variables
      if (values.env) {
        mcpServer.env = parseKeyValueString(values.env)
      }

      if (values.headers) {
        mcpServer.headers = parseKeyValueString(values.headers)
      }

      if (server.isActive) {
        try {
          await window.api.mcp.restartServer(mcpServer)
          updateMCPServer({ ...mcpServer, isActive: true })
          window.message.success({ content: t('settings.mcp.updateSuccess'), key: 'mcp-update-success' })
          setIsFormChanged(false)
        } catch (error: any) {
          updateMCPServer({ ...mcpServer, isActive: false })
          window.modal.error({
            title: t('settings.mcp.updateError'),
            content: error.message,
            centered: true
          })
        }
      } else {
        updateMCPServer({ ...mcpServer, isActive: false })
        window.message.success({ content: t('settings.mcp.updateSuccess'), key: 'mcp-update-success' })
        setIsFormChanged(false)
      }
      setLoading(false)
    } catch (error: any) {
      setLoading(false)
      console.error('Failed to save MCP server settings:', error)
    }
  }

  // Watch for command field changes
  const handleCommandChange = (command: string) => {
    if (command.includes('uv') || command.includes('uvx')) {
      setIsShowRegistry(true)
      setRegistry(PipRegistry)
    } else if (command.includes('npx') || command.includes('bun') || command.includes('bunx')) {
      setIsShowRegistry(true)
      setRegistry(NpmRegistry)
    } else {
      setIsShowRegistry(false)
      setRegistry(undefined)
    }
  }

  const onSelectRegistry = (url: string) => {
    const command = form.getFieldValue('command') || ''

    // If custom registry is selected
    if (url === 'custom') {
      setSelectedRegistryType('custom')
      // Don't set the registryUrl yet, wait for user input
      return
    }

    setSelectedRegistryType('')
    setCustomRegistryUrl('')

    // Add new registry env variables
    if (command.includes('uv') || command.includes('uvx')) {
      // envs['PIP_INDEX_URL'] = url
      // envs['UV_DEFAULT_INDEX'] = url
      form.setFieldsValue({ registryUrl: url })
    } else if (command.includes('npx') || command.includes('bun') || command.includes('bunx')) {
      // envs['NPM_CONFIG_REGISTRY'] = url
      form.setFieldsValue({ registryUrl: url })
    }

    // Mark form as changed
    setIsFormChanged(true)
  }

  const onCustomRegistryChange = (url: string) => {
    setCustomRegistryUrl(url)
    form.setFieldsValue({ registryUrl: url })
    setIsFormChanged(true)
  }

  const onDeleteMcpServer = useCallback(
    async (server: MCPServer) => {
      try {
        window.modal.confirm({
          title: t('settings.mcp.deleteServer'),
          content: t('settings.mcp.deleteServerConfirm'),
          centered: true,
          onOk: async () => {
            await window.api.mcp.removeServer(server)
            deleteMCPServer(server.id)
            window.message.success({ content: t('settings.mcp.deleteSuccess'), key: 'mcp-list' })
            navigate('/settings/mcp')
          }
        })
      } catch (error: any) {
        window.message.error({
          content: `${t('settings.mcp.deleteError')}: ${error.message}`,
          key: 'mcp-list'
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [server, t]
  )

  const onToggleActive = async (active: boolean) => {
    if (isFormChanged && active) {
      await onSave()
      return
    }

    await form.validateFields()
    setLoadingServer(server.id)
    const oldActiveState = server.isActive

    try {
      if (active) {
        const localTools = await window.api.mcp.listTools(server)
        setTools(localTools)

        const localPrompts = await window.api.mcp.listPrompts(server)
        setPrompts(localPrompts)

        const localResources = await window.api.mcp.listResources(server)
        setResources(localResources)
      } else {
        await window.api.mcp.stopServer(server)
      }
      updateMCPServer({ ...server, isActive: active })
    } catch (error: any) {
      window.modal.error({
        title: t('settings.mcp.startError'),
        content: formatMcpError(error),
        centered: true
      })
      updateMCPServer({ ...server, isActive: oldActiveState })
    } finally {
      setLoadingServer(null)
    }
  }

  // Handle toggling a tool on/off
  const handleToggleTool = useCallback(
    async (tool: MCPTool, enabled: boolean) => {
      // Create a new disabledTools array or use the existing one
      let disabledTools = [...(server.disabledTools || [])]

      if (enabled) {
        // Remove tool from disabledTools if it's being enabled
        disabledTools = disabledTools.filter((name) => name !== tool.name)
      } else {
        // Add tool to disabledTools if it's being disabled
        if (!disabledTools.includes(tool.name)) {
          disabledTools.push(tool.name)
        }
      }

      // Update the server with new disabledTools
      const updatedServer = {
        ...server,
        disabledTools
      }

      // Save the updated server configuration
      // await window.api.mcp.updateServer(updatedServer)
      updateMCPServer(updatedServer)
    },
    [server, updateMCPServer]
  )

  const tabs = [
    {
      key: 'settings',
      label: t('settings.mcp.tabs.general'),
      children: (
        <Form
          form={form}
          layout="vertical"
          onValuesChange={() => setIsFormChanged(true)}
          style={{
            overflowY: 'auto',
            width: 'calc(100% + 10px)',
            paddingRight: '10px'
          }}>
          <Form.Item name="name" label={t('settings.mcp.name')} rules={[{ required: true, message: '' }]}>
            <Input placeholder={t('common.name')} disabled={server.type === 'inMemory'} />
          </Form.Item>
          <Form.Item name="description" label={t('settings.mcp.description')}>
            <TextArea rows={2} placeholder={t('common.description')} />
          </Form.Item>
          {server.type !== 'inMemory' && (
            <Form.Item
              name="serverType"
              label={t('settings.mcp.type')}
              rules={[{ required: true }]}
              initialValue="stdio">
              <Select
                onChange={(value) => setServerType(value)}
                options={[
                  { label: t('settings.mcp.stdio'), value: 'stdio' },
                  { label: t('settings.mcp.sse'), value: 'sse' },
                  { label: t('settings.mcp.streamableHttp'), value: 'streamableHttp' }
                ]}
              />
            </Form.Item>
          )}
          {serverType === 'sse' && (
            <>
              <Form.Item
                name="baseUrl"
                label={t('settings.mcp.url')}
                rules={[{ required: serverType === 'sse', message: '' }]}
                tooltip={t('settings.mcp.baseUrlTooltip')}>
                <Input placeholder="http://localhost:3000/sse" />
              </Form.Item>
              <Form.Item name="headers" label={t('settings.mcp.headers')} tooltip={t('settings.mcp.headersTooltip')}>
                <TextArea
                  rows={3}
                  placeholder={`Content-Type=application/json\nAuthorization=Bearer token`}
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>
            </>
          )}
          {serverType === 'streamableHttp' && (
            <>
              <Form.Item
                name="baseUrl"
                label={t('settings.mcp.url')}
                rules={[{ required: serverType === 'streamableHttp', message: '' }]}
                tooltip={t('settings.mcp.baseUrlTooltip')}>
                <Input placeholder="http://localhost:3000/mcp" />
              </Form.Item>
              <Form.Item name="headers" label={t('settings.mcp.headers')} tooltip={t('settings.mcp.headersTooltip')}>
                <TextArea
                  rows={3}
                  placeholder={`Content-Type=application/json\nAuthorization=Bearer token`}
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>
            </>
          )}
          {serverType === 'stdio' && (
            <>
              <Form.Item
                name="command"
                label={t('settings.mcp.command')}
                rules={[{ required: serverType === 'stdio', message: '' }]}>
                <Input placeholder="uvx or npx" onChange={(e) => handleCommandChange(e.target.value)} />
              </Form.Item>

              {isShowRegistry && registry && (
                <Form.Item
                  name="registryUrl"
                  label={t('settings.mcp.registry')}
                  tooltip={t('settings.mcp.registryTooltip')}>
                  <Radio.Group
                    value={selectedRegistryType === 'custom' ? 'custom' : form.getFieldValue('registryUrl') || ''}>
                    <Radio
                      key="no-proxy"
                      value=""
                      onChange={(e) => {
                        onSelectRegistry(e.target.value)
                      }}>
                      {t('settings.mcp.registryDefault')}
                    </Radio>
                    {registry.map((reg) => (
                      <Radio
                        key={reg.url}
                        value={reg.url}
                        onChange={(e) => {
                          onSelectRegistry(e.target.value)
                        }}>
                        {reg.name}
                      </Radio>
                    ))}
                  </Radio.Group>
                  {selectedRegistryType === 'custom' && (
                    <Input
                      placeholder={t(
                        'settings.mcp.customRegistryPlaceholder',
                        '请输入私有仓库地址，如: https://npm.company.com'
                      )}
                      value={customRegistryUrl}
                      onChange={(e) => onCustomRegistryChange(e.target.value)}
                      style={{ marginTop: 8 }}
                    />
                  )}
                </Form.Item>
              )}

              <Form.Item name="args" label={t('settings.mcp.args')} tooltip={t('settings.mcp.argsTooltip')}>
                <TextArea rows={3} placeholder={`arg1\narg2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>

              <Form.Item name="env" label={t('settings.mcp.env')} tooltip={t('settings.mcp.envTooltip')}>
                <TextArea rows={3} placeholder={`KEY1=value1\nKEY2=value2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </>
          )}
          {serverType === 'inMemory' && (
            <>
              <Form.Item name="args" label={t('settings.mcp.args')} tooltip={t('settings.mcp.argsTooltip')}>
                <TextArea rows={3} placeholder={`arg1\narg2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>

              <Form.Item name="env" label={t('settings.mcp.env')} tooltip={t('settings.mcp.envTooltip')}>
                <TextArea rows={3} placeholder={`KEY1=value1\nKEY2=value2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </>
          )}
          <Form.Item
            name="timeout"
            label={t('settings.mcp.timeout', 'Timeout')}
            tooltip={t(
              'settings.mcp.timeoutTooltip',
              'Timeout in seconds for requests to this server, default is 60 seconds'
            )}>
            <Input type="number" min={1} placeholder="60" addonAfter="s" />
          </Form.Item>

          <AdvancedSettingsButton onClick={() => setShowAdvanced(!showAdvanced)}>
            <ChevronDown
              size={18}
              style={{
                transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.3s',
                marginRight: 8,
                stroke: 'var(--color-primary)'
              }}
            />
            {t('common.advanced_settings')}
          </AdvancedSettingsButton>

          {showAdvanced && (
            <>
              <Form.Item name="provider" label={t('settings.mcp.provider', 'Provider')}>
                <Input placeholder={t('settings.mcp.providerPlaceholder', 'Provider name')} />
              </Form.Item>

              <Form.Item name="providerUrl" label={t('settings.mcp.providerUrl', 'Provider URL')}>
                <Input placeholder={t('settings.mcp.providerUrlPlaceholder', 'https://provider-website.com')} />
              </Form.Item>

              <Form.Item name="logoUrl" label={t('settings.mcp.logoUrl', 'Logo URL')}>
                <Input placeholder={t('settings.mcp.logoUrlPlaceholder', 'https://example.com/logo.png')} />
              </Form.Item>

              <Form.Item name="tags" label={t('settings.mcp.tags', 'Tags')}>
                <Select
                  mode="tags"
                  style={{ width: '100%' }}
                  placeholder={t('settings.mcp.tagsPlaceholder', 'Enter tags')}
                  tokenSeparators={[',']}
                />
              </Form.Item>
            </>
          )}
        </Form>
      )
    }
  ]

  if (server.searchKey) {
    tabs.push({
      key: 'description',
      label: t('settings.mcp.tabs.description'),
      children: <MCPDescription searchKey={server.searchKey} />
    })
  }

  if (server.isActive) {
    tabs.push(
      {
        key: 'tools',
        label: t('settings.mcp.tabs.tools'),
        children: <MCPToolsSection tools={tools} server={server} onToggleTool={handleToggleTool} />
      },
      {
        key: 'prompts',
        label: t('settings.mcp.tabs.prompts'),
        children: <MCPPromptsSection prompts={prompts} />
      },
      {
        key: 'resources',
        label: t('settings.mcp.tabs.resources'),
        children: <MCPResourcesSection resources={resources} />
      }
    )
  }

  return (
    <SettingContainer theme={theme} style={{ width: '100%', paddingTop: 55, backgroundColor: 'transparent' }}>
      <SettingGroup style={{ marginBottom: 0, borderRadius: 'var(--list-item-border-radius)' }}>
        <SettingTitle>
          <Flex justify="space-between" align="center" gap={5} style={{ marginRight: 10 }}>
            <ServerName className="text-nowrap">{server?.name}</ServerName>
            <Button danger icon={<DeleteOutlined />} type="text" onClick={() => onDeleteMcpServer(server)} />
          </Flex>
          <Flex align="center" gap={16}>
            <Switch
              value={server.isActive}
              key={server.id}
              loading={loadingServer === server.id}
              onChange={onToggleActive}
            />
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={onSave}
              loading={loading}
              shape="round"
              disabled={!isFormChanged || activeTab !== 'settings'}>
              {t('common.save')}
            </Button>
          </Flex>
        </SettingTitle>
        <SettingDivider />
        <Tabs
          defaultActiveKey="settings"
          items={tabs}
          onChange={(key) => setActiveTab(key as TabKey)}
          style={{ marginTop: 8, backgroundColor: 'transparent' }}
        />
      </SettingGroup>
    </SettingContainer>
  )
}

const ServerName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

const AdvancedSettingsButton = styled.div`
  cursor: pointer;
  margin-bottom: 16px;
  margin-top: -10px;
  color: var(--color-primary);
  display: flex;
  align-items: center;
`

export default McpSettings
