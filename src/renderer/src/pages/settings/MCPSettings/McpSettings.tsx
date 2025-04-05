import { DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPServer, MCPTool } from '@renderer/types'
import { Button, Flex, Form, Input, Radio, Switch } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '..'
import MCPToolsSection from './McpTool'

interface Props {
  server: MCPServer
}

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

const McpSettings: React.FC<Props> = ({ server }) => {
  const { t } = useTranslation()
  const { deleteMCPServer, updateMCPServer } = useMCPServers()
  const [serverType, setServerType] = useState<MCPServer['type']>('stdio')
  const [form] = Form.useForm<MCPFormValues>()
  const [loading, setLoading] = useState(false)
  const [isFormChanged, setIsFormChanged] = useState(false)
  const [loadingServer, setLoadingServer] = useState<string | null>(null)

  const [tools, setTools] = useState<MCPTool[]>([])
  const [isShowRegistry, setIsShowRegistry] = useState(false)
  const [registry, setRegistry] = useState<Registry[]>()

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

    form.setFieldsValue({
      name: server.name,
      description: server.description,
      serverType: serverType,
      baseUrl: server.baseUrl || '',
      command: server.command || '',
      registryUrl: server.registryUrl || '',
      isActive: server.isActive,
      args: server.args ? server.args.join('\n') : '',
      env: server.env
        ? Object.entries(server.env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : ''
    })
  }, [server, form])

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
        // window.message.success(t('settings.mcp.toolsLoaded'))
      } catch (error) {
        window.message.error({
          content: t('settings.mcp.toolsLoadError') + formatError(error),
          key: 'mcp-tools-error'
        })
      } finally {
        setLoadingServer(null)
      }
    }
  }

  useEffect(() => {
    if (server.isActive) {
      fetchTools()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.isActive])

  // Save the form data
  const onSave = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()

      // set basic fields
      const mcpServer: MCPServer = {
        id: server.id,
        name: values.name,
        type: values.serverType,
        description: values.description,
        isActive: values.isActive,
        registryUrl: values.registryUrl
      }

      // set stdio or sse server
      if (values.serverType === 'sse') {
        mcpServer.baseUrl = values.baseUrl
      } else {
        mcpServer.command = values.command
        mcpServer.args = values.args ? values.args.split('\n').filter((arg) => arg.trim() !== '') : []
      }

      // set env variables
      if (values.env) {
        const env: Record<string, string> = {}
        values.env.split('\n').forEach((line) => {
          if (line.trim()) {
            const [key, ...chunks] = line.split('=')
            const value = chunks.join('=')
            if (key && value) {
              env[key.trim()] = value.trim()
            }
          }
        })
        mcpServer.env = env
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
    await form.validateFields()
    setLoadingServer(server.id)
    const oldActiveState = server.isActive

    try {
      if (active) {
        const localTools = await window.api.mcp.listTools(server)
        setTools(localTools)
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

  return (
    <SettingContainer>
      <SettingGroup style={{ marginBottom: 0 }}>
        <SettingTitle>
          <Flex justify="space-between" align="center" gap={5} style={{ marginRight: 10 }}>
            <ServerName className="text-nowrap">{server?.name}</ServerName>
            {!(server.type === 'inMemory') && (
              <Button danger icon={<DeleteOutlined />} type="text" onClick={() => onDeleteMcpServer(server)} />
            )}
          </Flex>
          <Flex align="center" gap={16}>
            <Switch
              value={server.isActive}
              key={server.id}
              loading={loadingServer === server.id}
              onChange={onToggleActive}
            />
            <Button type="primary" icon={<SaveOutlined />} onClick={onSave} loading={loading} disabled={!isFormChanged}>
              {t('common.save')}
            </Button>
          </Flex>
        </SettingTitle>
        <SettingDivider />
        <Form
          form={form}
          layout="vertical"
          onValuesChange={() => setIsFormChanged(true)}
          style={{
            // height: 'calc(100vh - var(--navbar-height) - 315px)',
            overflowY: 'auto',
            width: 'calc(100% + 10px)',
            paddingRight: '10px'
          }}>
          <Form.Item name="name" label={t('settings.mcp.name')} rules={[{ required: true, message: '' }]}>
            <Input placeholder={t('common.name')} />
          </Form.Item>
          <Form.Item name="description" label={t('settings.mcp.description')}>
            <TextArea rows={2} placeholder={t('common.description')} />
          </Form.Item>
          <Form.Item name="serverType" label={t('settings.mcp.type')} rules={[{ required: true }]} initialValue="stdio">
            <Radio.Group
              onChange={(e) => setServerType(e.target.value)}
              options={[
                { label: t('settings.mcp.stdio'), value: 'stdio' },
                { label: t('settings.mcp.sse'), value: 'sse' },
                { label: t('settings.mcp.inMemory'), value: 'inMemory' }
              ]}
            />
          </Form.Item>
          {serverType === 'sse' && (
            <Form.Item
              name="baseUrl"
              label={t('settings.mcp.url')}
              rules={[{ required: serverType === 'sse', message: '' }]}
              tooltip={t('settings.mcp.baseUrlTooltip')}>
              <Input placeholder="http://localhost:3000/sse" />
            </Form.Item>
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
        </Form>
        {server.isActive && <MCPToolsSection tools={tools} server={server} onToggleTool={handleToggleTool} />}
      </SettingGroup>
    </SettingContainer>
  )
}

const ServerName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

export default McpSettings
