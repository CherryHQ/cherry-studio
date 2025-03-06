import { DeleteOutlined, EditOutlined, PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addMCPServer, deleteMCPServer, setMCPServerActive, updateMCPServer } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { Button, Card, Form, Input, message, Modal, Radio, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '.'

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

const MCPSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { Paragraph, Text } = Typography
  const dispatch = useAppDispatch()
  const mcpServers = useAppSelector((state) => state.mcp.servers)

  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingServer, setEditingServer] = useState<MCPServer | null>(null)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<MCPFormValues>()
  const [serverType, setServerType] = useState<'sse' | 'stdio'>('stdio')

  // Watch the serverType field to update the form layout dynamically
  useEffect(() => {
    const type = form.getFieldValue('serverType')
    if (type) {
      setServerType(type)
    }
  }, [form])

  const showAddModal = () => {
    form.resetFields()
    form.setFieldsValue({ serverType: 'stdio', isActive: true })
    setServerType('stdio')
    setEditingServer(null)
    setIsModalVisible(true)
  }

  const showEditModal = (server: MCPServer) => {
    setEditingServer(server)
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
    setIsModalVisible(true)
  }

  const handleCancel = () => {
    setIsModalVisible(false)
    form.resetFields()
  }

  const handleSubmit = () => {
    setLoading(true)
    form
      .validateFields()
      .then((values) => {
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
                const [key, value] = line.split('=')
                if (key && value) {
                  env[key.trim()] = value.trim()
                }
              }
            })
          }
          mcpServer.env = Object.keys(env).length > 0 ? env : undefined
        }

        if (editingServer) {
          window.api.mcp
            .updateServer(mcpServer)
            .then(() => {
              message.success(t('settings.mcp.updateSuccess'))
              setLoading(false)
              setIsModalVisible(false)
              form.resetFields()
            })
            .catch((error) => {
              message.error(`${t('settings.mcp.updateError')}: ${error.message}`)
              setLoading(false)
            })
          dispatch(updateMCPServer(mcpServer))
        } else {
          // Check for duplicate name
          if (mcpServers.some((server: MCPServer) => server.name === mcpServer.name)) {
            message.error(t('settings.mcp.duplicateName'))
            setLoading(false)
            return
          }

          window.api.mcp
            .addServer(mcpServer)
            .then(() => {
              message.success(t('settings.mcp.addSuccess'))
              setLoading(false)
              setIsModalVisible(false)
              form.resetFields()
            })
            .catch((error) => {
              message.error(`${t('settings.mcp.addError')}: ${error.message}`)
              setLoading(false)
            })
          dispatch(addMCPServer(mcpServer))
        }
      })
      .catch(() => {
        setLoading(false)
      })
  }

  const handleDelete = (serverName: string) => {
    Modal.confirm({
      title: t('settings.mcp.confirmDelete'),
      content: t('settings.mcp.confirmDeleteMessage'),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: () => {
        window.api.mcp
          .deleteServer(serverName)
          .then(() => {
            message.success(t('settings.mcp.deleteSuccess'))
          })
          .catch((error) => {
            message.error(`${t('settings.mcp.deleteError')}: ${error.message}`)
          })
        dispatch(deleteMCPServer(serverName))
      }
    })
  }

  const handleToggleActive = (name: string, isActive: boolean) => {
    window.api.mcp
      .setServerActive(name, isActive)
      .then(() => {
        // Optional: Show success message or update UI
      })
      .catch((error) => {
        message.error(`${t('settings.mcp.toggleError')}: ${error.message}`)
      })
    dispatch(setMCPServerActive({ name, isActive }))
  }

  const columns = [
    {
      title: t('settings.mcp.name'),
      dataIndex: 'name',
      key: 'name',
      width: '10%',
      render: (text: string, record: MCPServer) => <Text strong={record.isActive}>{text}</Text>
    },
    {
      title: t('settings.mcp.type'),
      key: 'type',
      width: '5%',
      render: (_: any, record: MCPServer) => <Tag color="cyan">{record.baseUrl ? 'SSE' : 'STDIO'}</Tag>
    },
    {
      title: t('settings.mcp.description'),
      dataIndex: 'description',
      key: 'description',
      width: '50%',
      render: (text: string) => {
        if (!text) {
          return (
            <Text type="secondary" italic>
              {t('common.description')}
            </Text>
          )
        }

        return (
          <Paragraph
            ellipsis={{
              rows: 1,
              expandable: 'collapsible',
              symbol: 'more',
              onExpand: () => {}, // Empty callback required for proper functionality
              tooltip: true
            }}
            style={{ marginBottom: 0 }}>
            {text}
          </Paragraph>
        )
      }
    },
    {
      title: t('settings.mcp.active'),
      dataIndex: 'isActive',
      key: 'isActive',
      width: '5%',
      render: (isActive: boolean, record: MCPServer) => (
        <Switch checked={isActive} onChange={(checked) => handleToggleActive(record.name, checked)} />
      )
    },
    {
      title: t('settings.mcp.actions'),
      key: 'actions',
      width: '10%',
      render: (_: any, record: MCPServer) => (
        <Space>
          <Tooltip title={t('common.edit')}>
            <Button type="primary" ghost icon={<EditOutlined />} onClick={() => showEditModal(record)} />
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.name)} />
          </Tooltip>
        </Space>
      )
    }
  ]

  // Create a CSS class for inactive rows instead of using jsx global
  const inactiveRowStyle = {
    opacity: 0.7,
    backgroundColor: theme === 'dark' ? '#1a1a1a' : '#f5f5f5'
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>
          {t('settings.mcp.title')}
          <Tooltip title={t('settings.mcp.config_description')}>
            <QuestionCircleOutlined style={{ marginLeft: 8, fontSize: 14 }} />
          </Tooltip>
        </SettingTitle>
        <SettingDivider />
        <Paragraph type="secondary" style={{ margin: '0 0 20px 0' }}>
          {t('settings.mcp.config_description')}
        </Paragraph>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={showAddModal}>
            {t('settings.mcp.addServer')}
          </Button>
          <Text type="secondary">
            {mcpServers.length}{' '}
            {mcpServers.length === 1 ? t('settings.mcp.serverSingular') : t('settings.mcp.serverPlural')}
          </Text>
        </div>

        <Card bordered={false} style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
          <Table
            dataSource={mcpServers}
            columns={columns}
            rowKey="name"
            pagination={false}
            locale={{ emptyText: t('settings.mcp.noServers') }}
            rowClassName={(record) => (!record.isActive ? 'inactive-row' : '')}
            onRow={(record) => ({
              style: !record.isActive ? inactiveRowStyle : {}
            })}
          />
        </Card>

        <Modal
          title={editingServer ? t('settings.mcp.editServer') : t('settings.mcp.addServer')}
          open={isModalVisible}
          onCancel={handleCancel}
          onOk={handleSubmit}
          confirmLoading={loading}
          width={600}>
          <Form form={form} layout="vertical">
            <Form.Item
              name="name"
              label={t('settings.mcp.name')}
              rules={[{ required: true, message: t('settings.mcp.nameRequired') }]}>
              <Input disabled={!!editingServer} placeholder={t('common.name')} />
            </Form.Item>

            <Form.Item name="description" label={t('settings.mcp.description')}>
              <TextArea rows={2} placeholder={t('common.description')} />
            </Form.Item>

            <Form.Item
              name="serverType"
              label={t('settings.mcp.type')}
              rules={[{ required: true }]}
              initialValue="stdio">
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
                  <TextArea rows={3} placeholder="arg1\narg2" style={{ fontFamily: 'monospace' }} />
                </Form.Item>

                <Form.Item name="env" label={t('settings.mcp.env')} tooltip={t('settings.mcp.envTooltip')}>
                  <TextArea rows={3} placeholder="KEY1=value1\nKEY2=value2" style={{ fontFamily: 'monospace' }} />
                </Form.Item>
              </>
            )}

            <Form.Item name="isActive" label={t('settings.mcp.active')} valuePropName="checked" initialValue={true}>
              <Switch />
            </Form.Item>
          </Form>
        </Modal>
      </SettingGroup>
    </SettingContainer>
  )
}

export default MCPSettings
