import { MCPServer, MCPTool } from '@renderer/types'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
import { Badge, Descriptions, Empty, Flex, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { ColumnsType } from 'antd/es/table'
import { Hammer, Info, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface MCPToolsSectionProps {
  tools: MCPTool[]
  server: MCPServer
  onToggleTool: (tool: MCPTool, enabled: boolean) => void
  onToggleAutoApprove: (tool: MCPTool, autoApprove: boolean) => void
}

const MCPToolsSection = ({ tools, server, onToggleTool, onToggleAutoApprove }: MCPToolsSectionProps) => {
  const { t } = useTranslation()

  // Check if a tool is enabled (not in the disabledTools array)
  const isToolEnabled = (tool: MCPTool) => {
    return !server.disabledTools?.includes(tool.name)
  }

  // Handle tool toggle
  const handleToggle = (tool: MCPTool, checked: boolean) => {
    onToggleTool(tool, checked)
  }

  // Handle auto-approve toggle
  const handleAutoApproveToggle = (tool: MCPTool, checked: boolean) => {
    onToggleAutoApprove(tool, checked)
  }

  // Render tool properties from the input schema
  const renderToolProperties = (tool: MCPTool) => {
    if (!tool.inputSchema?.properties) return null

    const getTypeColor = (type: string) => {
      switch (type) {
        case 'string':
          return 'blue'
        case 'number':
          return 'green'
        case 'boolean':
          return 'purple'
        case 'object':
          return 'orange'
        case 'array':
          return 'cyan'
        default:
          return 'default'
      }
    }

    // <Typography.Title level={5}>{t('settings.mcp.tools.inputSchema')}:</Typography.Title>
    return (
      <Descriptions bordered size="small" column={1} style={{ userSelect: 'text' }}>
        {Object.entries(tool.inputSchema.properties).map(([key, prop]: [string, any]) => (
          <Descriptions.Item
            key={key}
            label={
              <Flex gap={4}>
                <Typography.Text strong>{key}</Typography.Text>
                {tool.inputSchema.required?.includes(key) && (
                  <Tooltip title="Required field">
                    <span style={{ color: '#f5222d' }}>*</span>
                  </Tooltip>
                )}
              </Flex>
            }>
            <Flex vertical gap={4}>
              <Flex align="center" gap={8}>
                {prop.type && (
                  // <Typography.Text type="secondary">{prop.type} </Typography.Text>
                  <Badge
                    color={getTypeColor(prop.type)}
                    text={<Typography.Text type="secondary">{prop.type}</Typography.Text>}
                  />
                )}
              </Flex>
              {prop.description && (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
                  {prop.description}
                </Typography.Paragraph>
              )}
              {prop.enum && (
                <div style={{ marginTop: 4 }}>
                  <Typography.Text type="secondary">
                    {t('settings.mcp.tools.inputSchema.enum.allowedValues')}
                  </Typography.Text>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {prop.enum.map((value: string, idx: number) => (
                      <Tag key={idx}>{value}</Tag>
                    ))}
                  </div>
                </div>
              )}
            </Flex>
          </Descriptions.Item>
        ))}
      </Descriptions>
    )
  }

  const columns: ColumnsType<MCPTool> = [
    {
      title: <Typography.Text strong>{t('settings.mcp.tools.availableTools')}</Typography.Text>,
      dataIndex: 'name',
      key: 'name',
      filters: tools.map((tool) => ({
        text: tool.name,
        value: tool.name
      })),
      onFilter: (value, record) => record.name === value,
      filterSearch: true,
      render: (_, tool) => (
        <Flex vertical align="flex-start" gap={4}>
          <Flex align="center" gap={4}>
            <Typography.Text strong ellipsis={{ tooltip: tool.name }}>
              {tool.name}
            </Typography.Text>
            <Tooltip title={`ID: ${tool.id}`} mouseEnterDelay={0}>
              <Info size={14} />
            </Tooltip>
          </Flex>
          {tool.description && (
            <Typography.Paragraph
              type="secondary"
              style={{ fontSize: '13px' }}
              ellipsis={{ rows: 1, expandable: true }}>
              {tool.description}
            </Typography.Paragraph>
          )}
        </Flex>
      )
    },
    {
      title: (
        <Flex align="center" justify="center" gap={4}>
          <Hammer size={14} color="orange" />
          <Typography.Text strong>{t('settings.mcp.tools.enable')}</Typography.Text>
        </Flex>
      ),
      key: 'enable',
      width: 150, // Fixed width might be good for alignment
      align: 'center',
      render: (_, tool) => (
        <Switch checked={isToolEnabled(tool)} onChange={(checked) => handleToggle(tool, checked)} size="small" />
      )
    },
    {
      title: (
        <Flex align="center" justify="center" gap={4}>
          <Zap size={14} color="red" />
          <Typography.Text strong>{t('settings.mcp.tools.autoApprove')}</Typography.Text>
        </Flex>
      ),
      key: 'autoApprove',
      width: 150, // Fixed width
      align: 'center',
      render: (_, tool) => (
        <Tooltip
          title={
            !isToolEnabled(tool)
              ? t('settings.mcp.tools.autoApprove.tooltip.howToEnable')
              : isToolAutoApproved(tool, server)
                ? t('settings.mcp.tools.autoApprove.tooltip.enabled')
                : t('settings.mcp.tools.autoApprove.tooltip.disabled')
          }
          placement="top">
          <Switch
            checked={isToolAutoApproved(tool, server)}
            disabled={!isToolEnabled(tool)}
            onChange={(checked) => handleAutoApproveToggle(tool, checked)}
            size="small"
          />
        </Tooltip>
      )
    }
  ]

  return tools.length > 0 ? (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={tools}
      pagination={false}
      expandable={{
        expandedRowRender: (tool) => renderToolProperties(tool)
      }}
    />
  ) : (
    <Empty description={t('settings.mcp.tools.noToolsAvailable')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
  )
}

export default MCPToolsSection
