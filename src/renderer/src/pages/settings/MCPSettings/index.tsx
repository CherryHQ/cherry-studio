import {
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppSelector } from '@renderer/store'
import { MCPServer } from '@renderer/types'
import { Button, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from '..'
import AddMcpServerPopup from './AddMcpServerPopup'
import EditMcpJsonPopup from './EditMcpJsonPopup'
import InstallNpxUv from './InstallNpxUv'
import NpxSearch from './NpxSearch'

const MCPSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { Paragraph, Text } = Typography
  const mcpServers = useAppSelector((state) => state.mcp.servers)
  const [loadingServer, setLoadingServer] = useState<string | null>(null)

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
    setLoadingServer(name)
    try {
      await window.api.mcp.setServerActive(name, isActive)
    } catch (error: any) {
      window.message.error(`${t('settings.mcp.toggleError')}: ${error.message}`)
    } finally {
      setLoadingServer(null)
    }
  }

  const handleOpenMCPServers = () => {
    window.open('https://glama.ai/mcp/servers', '_blank')
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
            className="selectable"
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
        <Switch
          checked={isActive}
          loading={loadingServer === record.name}
          onChange={(checked) => handleToggleActive(record.name, checked)}
        />
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
      <InstallNpxUv />
      <SettingGroup theme={theme}>
        <SettingTitle>
          {t('settings.mcp.title')}
          <Tooltip title={t('settings.mcp.config_description')}>
            <QuestionCircleOutlined style={{ marginLeft: 8, fontSize: 14 }} />
          </Tooltip>
        </SettingTitle>
        <SettingDivider />
        <HStack gap={15} alignItems="center">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => AddMcpServerPopup.show()}>
            {t('settings.mcp.addServer')}
          </Button>
          <Button icon={<EditOutlined />} onClick={() => EditMcpJsonPopup.show()}>
            {t('settings.mcp.editJson')}
          </Button>
          <Button icon={<SearchOutlined />} onClick={handleOpenMCPServers}>
            {t('settings.mcp.findMore')} <LinkOutlined />
          </Button>
        </HStack>
        <Table
          dataSource={mcpServers}
          columns={columns}
          rowKey="name"
          pagination={false}
          size="small"
          locale={{ emptyText: t('settings.mcp.noServers') }}
          rowClassName={(record) => (!record.isActive ? 'inactive-row' : '')}
          onRow={(record) => ({ style: !record.isActive ? inactiveRowStyle : {} })}
          style={{ marginTop: 15 }}
        />
      </SettingGroup>
      <NpxSearch />
    </SettingContainer>
  )
}

export default MCPSettings
