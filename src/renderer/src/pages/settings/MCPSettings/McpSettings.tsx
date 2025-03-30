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
  serverType: 'sse' | 'stdio'
  baseUrl?: string
  command?: string
  args?: string
  env?: string
  isActive: boolean
}

const McpSettings: React.FC<Props> = ({ server }) => {
  const { t } = useTranslation()
  const { deleteMCPServer } = useMCPServers()
  const [serverType, setServerType] = useState<'sse' | 'stdio'>('stdio')
  const [form] = Form.useForm<MCPFormValues>()
  const [loading, setLoading] = useState(false)
  const [isFormChanged, setIsFormChanged] = useState(false)
  const [loadingServer, setLoadingServer] = useState<string | null>(null)
  const { updateMCPServer } = useMCPServers()
  const [tools, setTools] = useState<MCPTool[]>([])

  useEffect(() => {
    if (server) {
      form.setFieldsValue({
        name: server.name,
        description: server.description,
        serverType: server.baseUrl ? 'sse' : 'stdio',
        baseUrl: server.baseUrl || '',
        command: server.command || '',
        args: server.args ? server.args.join('\n') : '',
        env: server.env
          ? Object.entries(server.env)
              .map(([key, value]) => `${key}=${value}`)
              .join('\n')
          : '',
        isActive: server.isActive
      })
    }
  }, [form, server])

  useEffect(() => {
    const serverType = server.baseUrl ? 'sse' : 'stdio'
    setServerType(serverType)

    form.setFieldsValue({
      name: server.name,
      description: server.description,
      serverType: serverType,
      baseUrl: server.baseUrl || '',
      command: server.command || '',
      args: server.args ? server.args.join('\n') : '',
      env: server.env
        ? Object.entries(server.env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : ''
    })
  }, [form, server])

  // Watch the serverType field to update the form layout dynamically
  useEffect(() => {
    const type = form.getFieldValue('serverType')
    type && setServerType(type)
  }, [form])

  // Load tools on initial mount if server is active
  useEffect(() => {
    fetchTools()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Save the form data
  const onSave = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()

      const mcpServer: MCPServer = {
        id: server.id,
        name: values.name,
        description: values.description,
        isActive: values.isActive
      }

      if (values.serverType === 'sse') {
        mcpServer.baseUrl = values.baseUrl
      } else {
        mcpServer.command = values.command
        mcpServer.args = values.args ? values.args.split('\n').filter((arg) => arg.trim() !== '') : []

        const env: Record<string, string> = {}
        if (values.env) {
          values.env.split('\n').forEach((line) => {
            if (line.trim()) {
              const [key, ...chunks] = line.split('=')
              const value = chunks.join('=')
              if (key && value) {
                env[key.trim()] = value.trim()
              }
            }
          })
        }
        mcpServer.env = Object.keys(env).length > 0 ? env : undefined
      }

      try {
        await window.api.mcp.restartServer(mcpServer)
        updateMCPServer({ ...mcpServer, isActive: true })
        window.message.success({ content: t('settings.mcp.updateSuccess'), key: 'mcp-update-success' })
        await fetchTools()
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
    }
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

  const onFormValuesChange = () => {
    setIsFormChanged(true)
  }

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

  return (
    <SettingContainer>
      <SettingGroup style={{ marginBottom: 0 }}>
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
            <Button type="primary" icon={<SaveOutlined />} onClick={onSave} loading={loading} disabled={!isFormChanged}>
              {t('common.save')}
            </Button>
          </Flex>
        </SettingTitle>
        <SettingDivider />
        <Form
          form={form}
          layout="vertical"
          onValuesChange={onFormValuesChange}
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
                { label: 'STDIO', value: 'stdio' },
                { label: 'SSE', value: 'sse' }
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
                <Input placeholder="uvx or npx" />
              </Form.Item>

              <Form.Item
                name="args"
                label={t('settings.mcp.args')}
                tooltip={t('settings.mcp.argsTooltip')}
                rules={[{ required: serverType === 'stdio', message: '' }]}>
                <TextArea rows={3} placeholder={`arg1\narg2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>

              <Form.Item name="env" label={t('settings.mcp.env')} tooltip={t('settings.mcp.envTooltip')}>
                <TextArea rows={3} placeholder={`KEY1=value1\nKEY2=value2`} style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </>
          )}
        </Form>
        {server.isActive && <MCPToolsSection tools={tools} />}
      </SettingGroup>
    </SettingContainer>
  )
}

const ServerName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

export default McpSettings
