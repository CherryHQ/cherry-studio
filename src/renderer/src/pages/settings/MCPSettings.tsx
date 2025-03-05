import { DeleteOutlined, EditOutlined, PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addMCPServer, deleteMCPServer, setMCPServerActive, updateMCPServer } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { Button, Card, Form, Input, message, Modal, Space, Switch, Table, Tooltip, Typography } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '.'

interface MCPFormValues {
  name: string
  command: string
  description?: string
  args: string
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

  const showAddModal = () => {
    form.resetFields()
    setEditingServer(null)
    setIsModalVisible(true)
  }

  const showEditModal = (server: MCPServer) => {
    setEditingServer(server)
    form.setFieldsValue({
      name: server.name,
      command: server.command,
      description: server.description,
      args: server.args.join('\n'),
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
        const args = values.args ? values.args.split('\n').filter((arg) => arg.trim() !== '') : []

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

        const mcpServer: MCPServer = {
          name: values.name,
          command: values.command,
          description: values.description,
          args,
          env: Object.keys(env).length > 0 ? env : undefined,
          isActive: values.isActive
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
      width: '20%',
      render: (text: string, record: MCPServer) => <Text strong={record.isActive}>{text}</Text>
    },
    {
      title: t('settings.mcp.description'),
      dataIndex: 'description',
      key: 'description',
      width: '40%',
      render: (text: string) =>
        text || (
          <Text type="secondary" italic>
            {t('common.description')}
          </Text>
        )
    },
    {
      title: t('settings.mcp.active'),
      dataIndex: 'isActive',
      key: 'isActive',
      width: '15%',
      render: (isActive: boolean, record: MCPServer) => (
        <Switch checked={isActive} onChange={(checked) => handleToggleActive(record.name, checked)} />
      )
    },
    {
      title: t('settings.mcp.actions'),
      key: 'actions',
      width: '25%',
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
              name="command"
              label={t('settings.mcp.command')}
              rules={[{ required: true, message: t('settings.mcp.commandRequired') }]}>
              <Input placeholder="python script.py" />
            </Form.Item>

            <Form.Item name="args" label={t('settings.mcp.args')} tooltip={t('settings.mcp.argsTooltip')}>
              <TextArea rows={3} placeholder="{--param1}\n{--param2 value}" style={{ fontFamily: 'monospace' }} />
            </Form.Item>

            <Form.Item name="env" label={t('settings.mcp.env')} tooltip={t('settings.mcp.envTooltip')}>
              <TextArea rows={3} placeholder="KEY1=value1\nKEY2=value2" style={{ fontFamily: 'monospace' }} />
            </Form.Item>

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
