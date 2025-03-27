import { TopView } from '@renderer/components/TopView'
import { useAppSelector } from '@renderer/store'
import { MCPServer } from '@renderer/types'
import { Form, Input, Modal, Radio, Switch } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  server?: MCPServer
  create?: boolean
}

interface Props extends ShowParams {
  resolve: (data: any) => void
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

const PopupContainer: React.FC<Props> = ({ server, create, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [serverType, setServerType] = useState<'sse' | 'stdio'>('stdio')
  const mcpServers = useAppSelector((state) => state.mcp.servers)
  const [form] = Form.useForm<MCPFormValues>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (server) {
      // Determine server type based on server properties
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
          : '',
        isActive: server.isActive
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Watch the serverType field to update the form layout dynamically
  useEffect(() => {
    const type = form.getFieldValue('serverType')
    type && setServerType(type)
  }, [form])

  const onOK = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()
      const mcpServer: MCPServer = {
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

      if (server && !create) {
        try {
          await window.api.mcp.updateServer(mcpServer)
          window.message.success(t('settings.mcp.updateSuccess'))
          setLoading(false)
          setOpen(false)
          form.resetFields()
        } catch (error: any) {
          window.message.error(`${t('settings.mcp.updateError')}: ${error.message}`)
          setLoading(false)
        }
      } else {
        // Check for duplicate name
        if (mcpServers.some((server: MCPServer) => server.name === mcpServer.name)) {
          window.message.error(t('settings.mcp.duplicateName'))
          setLoading(false)
          return
        }

        try {
          await window.api.mcp.addServer(mcpServer)
          window.message.success(t('settings.mcp.addSuccess'))
          setLoading(false)
          setOpen(false)
          form.resetFields()
        } catch (error: any) {
          window.message.error(`${t('settings.mcp.addError')}: ${error.message}`)
          setLoading(false)
        }
      }
    } catch (error: any) {
      setLoading(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  AddMcpServerPopup.hide = onCancel

  return (
    <Modal
      title={server ? t('settings.mcp.editServer') : t('settings.mcp.addServer')}
      open={open}
      onOk={onOK}
      onCancel={onCancel}
      afterClose={onClose}
      confirmLoading={loading}
      maskClosable={false}
      width={600}
      transitionName="ant-move-down"
      centered
      styles={{
        body: {
          maxHeight: '70vh',
          overflowY: 'auto'
        }
      }}>
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label={t('settings.mcp.name')}
          rules={[{ required: true, message: t('settings.mcp.nameRequired') }]}>
          <Input disabled={!!server} placeholder={t('common.name')} />
        </Form.Item>

        <Form.Item name="description" label={t('settings.mcp.description')}>
          <TextArea rows={2} placeholder={t('common.description')} />
        </Form.Item>

        <Form.Item name="serverType" label={t('settings.mcp.type')} rules={[{ required: true }]} initialValue="stdio">
          <Radio.Group
            onChange={(e) => setServerType(e.target.value)}
            options={[
              { label: 'SSE (Server-Sent Events)', value: 'sse' },
              { label: 'STDIO (Standard Input/Output)', value: 'stdio' }
            ]}
          />
        </Form.Item>

        {serverType === 'sse' && (
          <Form.Item
            name="baseUrl"
            label={t('settings.mcp.url')}
            rules={[{ required: serverType === 'sse', message: t('settings.mcp.baseUrlRequired') }]}
            tooltip={t('settings.mcp.baseUrlTooltip')}>
            <Input placeholder="http://localhost:3000/sse" />
          </Form.Item>
        )}

        {serverType === 'stdio' && (
          <>
            <Form.Item
              name="command"
              label={t('settings.mcp.command')}
              rules={[{ required: serverType === 'stdio', message: t('settings.mcp.commandRequired') }]}>
              <Input placeholder="uvx or npx" />
            </Form.Item>

            <Form.Item name="args" label={t('settings.mcp.args')} tooltip={t('settings.mcp.argsTooltip')}>
              <TextArea rows={3} placeholder={`arg1\narg2`} style={{ fontFamily: 'monospace' }} />
            </Form.Item>

            <Form.Item name="env" label={t('settings.mcp.env')} tooltip={t('settings.mcp.envTooltip')}>
              <TextArea rows={3} placeholder={`KEY1=value1\nKEY2=value2`} style={{ fontFamily: 'monospace' }} />
            </Form.Item>
          </>
        )}

        <Form.Item name="isActive" label={t('settings.mcp.active')} valuePropName="checked" initialValue={true}>
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const TopViewKey = 'AddMcpServerPopup'

export default class AddMcpServerPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams = {}) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
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
