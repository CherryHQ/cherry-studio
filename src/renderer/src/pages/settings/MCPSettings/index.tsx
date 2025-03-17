import { DeleteOutlined, EditOutlined, PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setMCPServers } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { Button, Card, Input, Space, Switch, Table, Tabs, Tag, Tooltip, Typography } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '..'
import AddMcpServerPopup from './AddMcpServerPopup'
import NpxSearch from './NpxSearch'

const MCPSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { Paragraph, Text } = Typography
  const { TextArea } = Input
  const [activeTab, setActiveTab] = useState('normal')
  const [jsonConfig, setJsonConfig] = useState('')
  const [jsonSaving, setJsonSaving] = useState(false)
  const [jsonError, setJsonError] = useState('')
  const dispatch = useAppDispatch()
  const ipcRenderer = window.electron.ipcRenderer
  const mcpServers = useAppSelector((state) => state.mcp.servers)

  const handleDelete = (serverName: string) => {
    window.modal.confirm({
      title: t('settings.mcp.confirmDelete'),
      content: t('settings.mcp.confirmDeleteMessage'),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      centered: true,
      onOk: async () => {
        try {
          await window.api.mcp.deleteServer(serverName)
          window.message.success(t('settings.mcp.deleteSuccess'))
        } catch (error: any) {
          window.message.error(`${t('settings.mcp.deleteError')}: ${error.message}`)
        }
      }
    })
  }

  const handleToggleActive = async (name: string, isActive: boolean) => {
    try {
      await window.api.mcp.setServerActive(name, isActive)
    } catch (error: any) {
      window.message.error(`${t('settings.mcp.toggleError')}: ${error.message}`)
    }
  }

  const handleTabChange = (key: string) => {
    setActiveTab(key)

    if (key === 'json') {
      try {
        const mcpServersObj: Record<string, any> = {}

        mcpServers.forEach((server) => {
          const { name, ...serverData } = server
          mcpServersObj[name] = serverData
        })

        const standardFormat = {
          mcpServers: mcpServersObj
        }

        const formattedJson = JSON.stringify(standardFormat, null, 2)
        setJsonConfig(formattedJson)
        setJsonError('')
      } catch (error) {
        console.error('Failed to format JSON:', error)
        setJsonError(t('settings.mcp.jsonFormatError'))
      }
    }
  }

  const handleSaveJson = async () => {
    setJsonSaving(true)
    try {
      if (!jsonConfig.trim()) {
        dispatch(setMCPServers([]))
        window.message.success(t('settings.mcp.jsonSaveSuccess'))
        setJsonError('')
        setJsonSaving(false)
        return
      }
      const parsedConfig = JSON.parse(jsonConfig)

      if (!parsedConfig.mcpServers || typeof parsedConfig.mcpServers !== 'object') {
        throw new Error(t('settings.mcp.invalidMcpFormat'))
      }

      const serversArray: MCPServer[] = []
      for (const [name, serverConfig] of Object.entries(parsedConfig.mcpServers)) {
        const server: MCPServer = {
          name,
          isActive: false,
          ...(serverConfig as any)
        }
        serversArray.push(server)
      }

      dispatch(setMCPServers(serversArray))
      ipcRenderer.send('mcp:servers-from-renderer', mcpServers)

      window.message.success(t('settings.mcp.jsonSaveSuccess'))
      setJsonError('')
    } catch (error: any) {
      console.error('Failed to save JSON config:', error)
      setJsonError(error.message || t('settings.mcp.jsonSaveError'))
      window.message.error(t('settings.mcp.jsonSaveError'))
    } finally {
      setJsonSaving(false)
    }
  }

  const columns = [
    {
      title: t('settings.mcp.name'),
      dataIndex: 'name',
      key: 'name',
      width: '300px',
      render: (text: string, record: MCPServer) => <Text strong={record.isActive}>{text}</Text>
    },
    {
      title: t('settings.mcp.type'),
      key: 'type',
      width: '100px',
      render: (_: any, record: MCPServer) => <Tag color="cyan">{record.baseUrl ? 'SSE' : 'STDIO'}</Tag>
    },
    {
      title: t('settings.mcp.description'),
      dataIndex: 'description',
      key: 'description',
      width: 'auto',
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
              symbol: t('common.more'),
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
      width: '100px',
      render: (isActive: boolean, record: MCPServer) => (
        <Switch checked={isActive} onChange={(checked) => handleToggleActive(record.name, checked)} />
      )
    },
    {
      title: t('settings.mcp.actions'),
      key: 'actions',
      width: '100px',
      render: (_: any, record: MCPServer) => (
        <Space>
          <Tooltip title={t('common.edit')}>
            <Button
              type="primary"
              ghost
              icon={<EditOutlined />}
              onClick={() => AddMcpServerPopup.show({ server: record })}
            />
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

        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={[
            {
              label: t('settings.mcp.normalMode'),
              key: 'normal',
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => AddMcpServerPopup.show()}>
                      {t('settings.mcp.addServer')}
                    </Button>
                    <Text type="secondary">
                      {mcpServers.length}{' '}
                      {mcpServers.length === 1 ? t('settings.mcp.serverSingular') : t('settings.mcp.serverPlural')}
                    </Text>
                  </div>

                  <Card
                    bordered={false}
                    style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
                    styles={{ body: { padding: 0 } }}>
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
                </>
              )
            },
            {
              label: t('settings.mcp.jsonMode'),
              key: 'json',
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                    <Button type="primary" onClick={handleSaveJson} loading={jsonSaving}>
                      {t('common.save')}
                    </Button>
                    <Text type="secondary">{jsonError ? <span style={{ color: 'red' }}>{jsonError}</span> : ''}</Text>
                  </div>
                  <Card bordered={false} style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
                    <TextArea
                      value={jsonConfig}
                      onChange={(e) => setJsonConfig(e.target.value)}
                      style={{
                        width: '100%',
                        fontFamily: 'monospace',
                        minHeight: '400px',
                        marginBottom: '16px'
                      }}
                      onFocus={() => setJsonError('')}
                    />
                    <Text type="secondary">{t('settings.mcp.jsonModeHint')}</Text>
                  </Card>
                </>
              )
            }
          ]}></Tabs>
      </SettingGroup>
      <NpxSearch />
    </SettingContainer>
  )
}

export default MCPSettings
