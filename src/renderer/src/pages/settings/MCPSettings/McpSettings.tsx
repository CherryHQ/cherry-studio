import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPServer } from '@renderer/types'
import { Button, Flex, Form, Input, Radio, Switch } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingTitle } from '..'

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
  const [serverType, setServerType] = useState<'sse' | 'stdio'>('stdio')
  const [form] = Form.useForm<MCPFormValues>()
  const [loading, setLoading] = useState(false)
  const [isFormChanged, setIsFormChanged] = useState(false)
  const [loadingServer, setLoadingServer] = useState<string | null>(null)
  const { updateMCPServer } = useMCPServers()

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
        await window.api.mcp.listTools(mcpServer)
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
    }
  }

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

    try {
      if (active) {
        await window.api.mcp.listTools(server)
      }
      updateMCPServer({ ...server, isActive: active })
    } catch (error: any) {
      window.modal.error({
        title: t('settings.mcp.startError'),
        content: formatError(error),
        centered: true
      })
      console.error('[MCP] Error toggling server active', error)
    } finally {
      setLoadingServer(null)
    }
  }

  return (
    <SettingContainer style={{ background: 'transparent' }}>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ServerName>{server?.name}</ServerName>
        </Flex>
        <Switch
          value={server.isActive}
          key={server.id}
          loading={loadingServer === server.id}
          onChange={onToggleActive}
        />
      </SettingTitle>
      <SettingDivider />
      <Form form={form} layout="vertical" onValuesChange={onFormValuesChange}>
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
              { label: 'SSE', value: 'sse' },
              { label: 'STDIO', value: 'stdio' }
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
        <Button type="primary" onClick={onSave} loading={loading} disabled={!isFormChanged}>
          {t('common.save')}
        </Button>
      </Form>
    </SettingContainer>
  )
}

const ServerName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

export default McpSettings
