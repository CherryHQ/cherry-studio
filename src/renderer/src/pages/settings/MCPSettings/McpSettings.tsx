import { DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import MCPDescription from '@renderer/pages/settings/MCPSettings/McpDescription'
import { MCPPrompt, MCPResource, MCPServer, MCPTool } from '@renderer/types'
import { Button, Collapse, Flex, Form, Input, Radio, Select, Switch, Tabs } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import {
  AlignLeft,
  Building2,
  Clock,
  Code,
  Database,
  FileText,
  Globe,
  Image,
  Link,
  ListPlus,
  MessageSquare,
  Package,
  Server,
  Settings,
  Tag,
  Terminal,
  Type,
  Wrench
} from 'lucide-react'
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

const NpmRegistry: Registry[] = [{ name: '淘宝 NPM Mirror', url: 'https://registry.npmmirror.com' }]
const PipRegistry: Registry[] = [
  { name: '清华大学', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { name: '阿里云', url: 'http://mirrors.aliyun.com/pypi/simple/' },
  { name: '中国科学技术大学', url: 'https://mirrors.ustc.edu.cn/pypi/simple/' },
  { name: '华为云', url: 'https://repo.huaweicloud.com/repository/pypi/simple/' },
  { name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/pypi/simple/' }
]

type TabKey = 'settings' | 'tools' | 'prompts' | 'resources'

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
  const { mcpServers } = useMCPServers()
  const server = mcpServers.find((it) => it.id === serverId) as MCPServer
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
        if (server.command.includes('uv') || server.command.includes('uvx')) {
          setRegistry(PipRegistry)
        } else if (
          server.command.includes('npx') ||
          server.command.includes('bun') ||
          server.command.includes('bunx')
        ) {
          setRegistry(NpmRegistry)
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
        window.message.error({
          content: t('settings.mcp.tools.loadError') + ' ' + formatError(error),
          key: 'mcp-tools-error'
        })
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
        window.message.error({
          content: t('settings.mcp.prompts.loadError') + ' ' + formatError(error),
          key: 'mcp-prompts-error'
        })
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
        window.message.error({
          content: t('settings.mcp.resources.loadError') + ' ' + formatError(error),
          key: 'mcp-resources-error'
        })
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
      if (values.serverType === 'sse' || server.type === 'streamableHttp') {
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

      try {
        await window.api.mcp.restartServer(mcpServer)
        updateMCPServer({ ...mcpServer, isActive: true })
        window.message.success({ content: t('settings.mcp.updateSuccess'), key: 'mcp-update-success' })
        setLoading(false)
        setIsFormChanged(false)
      } catch (error: any) {
        updateMCPServer({ ...mcpServer, isActive: false })
        window.modal.error({
          title: t('settings.mcp.updateError'),
          content: error.message,
          centered: true
        })
        setLoading(false)
      }
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

  const formatError = (error: any) => {
    if (error.message.includes('32000')) {
      return t('settings.mcp.errors.32000')
    }

    return error.message
  }

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
        content: formatError(error),
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
      label: (
        <Flex align="center" gap={8}>
          <Settings size={16} />
          {t('settings.mcp.tabs.general')}
        </Flex>
      ),
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
          <Form.Item
            name="name"
            label={
              <FormLabelWithIcon>
                <Type size={16} />
                {t('settings.mcp.name')}
              </FormLabelWithIcon>
            }
            rules={[{ required: true, message: '' }]}>
            <Input placeholder={t('common.name')} disabled={server.type === 'inMemory'} />
          </Form.Item>
          <Form.Item
            name="description"
            label={
              <FormLabelWithIcon>
                <AlignLeft size={16} />
                {t('settings.mcp.description')}
              </FormLabelWithIcon>
            }>
            <TextArea rows={2} placeholder={t('common.description')} />
          </Form.Item>
          {server.type !== 'inMemory' && (
            <Form.Item
              name="serverType"
              label={
                <FormLabelWithIcon>
                  <Server size={16} />
                  {t('settings.mcp.type')}
                </FormLabelWithIcon>
              }
              rules={[{ required: true }]}
              initialValue="stdio">
              <Radio.Group
                onChange={(e) => setServerType(e.target.value)}
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
                label={
                  <FormLabelWithIcon>
                    <Link size={16} />
                    {t('settings.mcp.url')}
                  </FormLabelWithIcon>
                }
                rules={[{ required: serverType === 'sse', message: '' }]}
                tooltip={t('settings.mcp.baseUrlTooltip')}>
                <Input placeholder="http://localhost:3000/sse" />
              </Form.Item>
              <Form.Item
                name="headers"
                label={
                  <FormLabelWithIcon>
                    <Code size={16} />
                    {t('settings.mcp.headers')}
                  </FormLabelWithIcon>
                }
                tooltip={t('settings.mcp.headersTooltip')}>
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
                label={
                  <FormLabelWithIcon>
                    <Link size={16} />
                    {t('settings.mcp.url')}
                  </FormLabelWithIcon>
                }
                rules={[{ required: serverType === 'streamableHttp', message: '' }]}
                tooltip={t('settings.mcp.baseUrlTooltip')}>
                <Input placeholder="http://localhost:3000/mcp" />
              </Form.Item>
              <Form.Item
                name="headers"
                label={
                  <FormLabelWithIcon>
                    <Code size={16} />
                    {t('settings.mcp.headers')}
                  </FormLabelWithIcon>
                }
                tooltip={t('settings.mcp.headersTooltip')}>
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
                label={
                  <FormLabelWithIcon>
                    <Terminal size={16} />
                    {t('settings.mcp.command')}
                  </FormLabelWithIcon>
                }
                rules={[{ required: serverType === 'stdio', message: '' }]}>
                <Input placeholder="uvx or npx" onChange={(e) => handleCommandChange(e.target.value)} />
              </Form.Item>

              {isShowRegistry && registry && (
                <Form.Item
                  name="registryUrl"
                  label={
                    <FormLabelWithIcon>
                      <Package size={16} />
                      {t('settings.mcp.registry')}
                    </FormLabelWithIcon>
                  }
                  tooltip={t('settings.mcp.registryTooltip')}>
                  <Radio.Group>
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
                </Form.Item>
              )}

              <Form.Item
                name="args"
                label={
                  <FormLabelWithIcon>
                    <ListPlus size={16} />
                    {t('settings.mcp.args')}
                  </FormLabelWithIcon>
                }
                tooltip={t('settings.mcp.argsTooltip')}>
                <TextArea rows={3} placeholder={`arg1\narg2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>

              <Form.Item
                name="env"
                label={
                  <FormLabelWithIcon>
                    <Settings size={16} />
                    {t('settings.mcp.env')}
                  </FormLabelWithIcon>
                }
                tooltip={t('settings.mcp.envTooltip')}>
                <TextArea rows={3} placeholder={`KEY1=value1\nKEY2=value2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </>
          )}
          {serverType === 'inMemory' && (
            <>
              <Form.Item
                name="args"
                label={
                  <FormLabelWithIcon>
                    <ListPlus size={16} />
                    {t('settings.mcp.args')}
                  </FormLabelWithIcon>
                }
                tooltip={t('settings.mcp.argsTooltip')}>
                <TextArea rows={3} placeholder={`arg1\narg2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>

              <Form.Item
                name="env"
                label={
                  <FormLabelWithIcon>
                    <Settings size={16} />
                    {t('settings.mcp.env')}
                  </FormLabelWithIcon>
                }
                tooltip={t('settings.mcp.envTooltip')}>
                <TextArea rows={3} placeholder={`KEY1=value1\nKEY2=value2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </>
          )}
          <Form.Item
            name="timeout"
            label={
              <FormLabelWithIcon>
                <Clock size={16} />
                {t('settings.mcp.timeout', 'Timeout')}
              </FormLabelWithIcon>
            }
            tooltip={t(
              'settings.mcp.timeoutTooltip',
              'Timeout in seconds for requests to this server, default is 60 seconds'
            )}>
            <Input type="number" min={1} placeholder="60" addonAfter="s" />
          </Form.Item>

          <Collapse
            ghost
            style={{ marginBottom: 16 }}
            defaultActiveKey={[]}
            items={[
              {
                key: 'advanced',
                label: t('settings.mcp.advancedSettings', 'Advanced Settings'),
                children: (
                  <>
                    <Form.Item
                      name="provider"
                      label={
                        <FormLabelWithIcon>
                          <Building2 size={16} />
                          {t('settings.mcp.provider', 'Provider')}
                        </FormLabelWithIcon>
                      }>
                      <Input placeholder={t('settings.mcp.providerPlaceholder', 'Provider name')} />
                    </Form.Item>

                    <Form.Item
                      name="providerUrl"
                      label={
                        <FormLabelWithIcon>
                          <Globe size={16} />
                          {t('settings.mcp.providerUrl', 'Provider URL')}
                        </FormLabelWithIcon>
                      }>
                      <Input placeholder={t('settings.mcp.providerUrlPlaceholder', 'https://provider-website.com')} />
                    </Form.Item>

                    <Form.Item
                      name="logoUrl"
                      label={
                        <FormLabelWithIcon>
                          <Image size={16} />
                          {t('settings.mcp.logoUrl', 'Logo URL')}
                        </FormLabelWithIcon>
                      }>
                      <Input placeholder={t('settings.mcp.logoUrlPlaceholder', 'https://example.com/logo.png')} />
                    </Form.Item>

                    <Form.Item
                      name="tags"
                      label={
                        <FormLabelWithIcon>
                          <Tag size={16} />
                          {t('settings.mcp.tags', 'Tags')}
                        </FormLabelWithIcon>
                      }>
                      <Select
                        mode="tags"
                        style={{ width: '100%' }}
                        placeholder={t('settings.mcp.tagsPlaceholder', 'Enter tags')}
                        tokenSeparators={[',']}
                      />
                    </Form.Item>
                  </>
                )
              }
            ]}
          />
        </Form>
      )
    }
  ]
  if (server.searchKey) {
    tabs.push({
      key: 'description',
      label: (
        <Flex align="center" gap={8}>
          <FileText size={16} />
          {t('settings.mcp.tabs.description')}
        </Flex>
      ),
      children: <MCPDescription searchKey={server.searchKey} />
    })
  }

  if (server.isActive) {
    tabs.push(
      {
        key: 'tools',
        label: (
          <Flex align="center" gap={8}>
            <Wrench size={16} />
            {t('settings.mcp.tabs.tools')}
          </Flex>
        ),
        children: <MCPToolsSection tools={tools} server={server} onToggleTool={handleToggleTool} />
      },
      {
        key: 'prompts',
        label: (
          <Flex align="center" gap={8}>
            <MessageSquare size={16} />
            {t('settings.mcp.tabs.prompts')}
          </Flex>
        ),
        children: <MCPPromptsSection prompts={prompts} />
      },
      {
        key: 'resources',
        label: (
          <Flex align="center" gap={8}>
            <Database size={16} />
            {t('settings.mcp.tabs.resources')}
          </Flex>
        ),
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

const FormLabelWithIcon = styled(Flex)`
  align-items: center;
  gap: 8px;
`

export default McpSettings
