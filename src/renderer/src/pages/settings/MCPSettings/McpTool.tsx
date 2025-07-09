import { PauseCircleOutlined, PlayCircleOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { MCPServer, MCPTool } from '@renderer/types'
import { Badge, Collapse, Descriptions, Empty, Flex, Switch, Tag, Tooltip, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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

  // Check if auto-approve is enabled for a tool
  const isAutoApproveEnabled = (tool: MCPTool) => {
    return !server.disabledAutoApproveTools?.includes(tool.name)
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

    return (
      <div style={{ marginTop: 12 }}>
        <Typography.Title level={5}>{t('settings.mcp.tools.inputSchema')}:</Typography.Title>
        <Descriptions bordered size="small" column={1} style={{ marginTop: 8 }}>
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
                    <Typography.Text type="secondary">Allowed values: </Typography.Text>
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
      </div>
    )
  }

  return (
    <Section>
      <SectionTitle>{t('settings.mcp.tools.availableTools')}</SectionTitle>
      {tools.length > 0 ? (
        <Collapse bordered={false} ghost>
          {tools.map((tool) => (
            <Collapse.Panel
              key={tool.id}
              header={
                <Flex justify="space-between" align="center" style={{ width: '100%' }}>
                  <Flex vertical align="flex-start">
                    <Flex align="center" style={{ width: '100%' }}>
                      <Typography.Text strong>{tool.name}</Typography.Text>
                      <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: '12px' }}>
                        {tool.id}
                      </Typography.Text>
                    </Flex>
                    {tool.description && (
                      <Typography.Text type="secondary" style={{ fontSize: '13px', marginTop: 4 }}>
                        {tool.description.length > 100 ? `${tool.description.substring(0, 100)}...` : tool.description}
                      </Typography.Text>
                    )}
                  </Flex>
                  <SwitchContainer>
                    <SwitchGroup>
                      <SwitchLabel>
                        {isToolEnabled(tool) ? (
                          <PlayCircleOutlined style={{ fontSize: '14px', color: '#52c41a' }} />
                        ) : (
                          <PauseCircleOutlined style={{ fontSize: '14px', color: '#d9d9d9' }} />
                        )}
                        <Typography.Text type="secondary" style={{ fontSize: '12px', fontWeight: 500 }}>
                          {t('settings.mcp.tools.enable', 'Enable Tool')}
                        </Typography.Text>
                      </SwitchLabel>
                      <Switch
                        checked={isToolEnabled(tool)}
                        onChange={(checked, event) => {
                          event?.stopPropagation()
                          handleToggle(tool, checked)
                        }}
                      />
                    </SwitchGroup>
                    <SwitchGroup>
                      <Tooltip
                        title={
                          !isToolEnabled(tool)
                            ? 'Enable the tool first to use auto-approve'
                            : isAutoApproveEnabled(tool)
                              ? 'Tool will run automatically without confirmation'
                              : 'Tool will require manual approval before running'
                        }
                        placement="topRight">
                        <SwitchLabel>
                          <ThunderboltOutlined
                            style={{
                              fontSize: '14px',
                              color: isAutoApproveEnabled(tool) && isToolEnabled(tool) ? '#faad14' : '#d9d9d9'
                            }}
                          />
                          <Typography.Text type="secondary" style={{ fontSize: '12px', fontWeight: 500 }}>
                            {t('settings.mcp.tools.autoApprove', 'Auto Approve')}
                          </Typography.Text>
                        </SwitchLabel>
                      </Tooltip>
                      <Switch
                        checked={isAutoApproveEnabled(tool)}
                        disabled={!isToolEnabled(tool)}
                        onChange={(checked, event) => {
                          event?.stopPropagation()
                          handleAutoApproveToggle(tool, checked)
                        }}
                      />
                    </SwitchGroup>
                  </SwitchContainer>
                </Flex>
              }>
              <SelectableContent>{renderToolProperties(tool)}</SelectableContent>
            </Collapse.Panel>
          ))}
        </Collapse>
      ) : (
        <Empty description={t('settings.mcp.tools.noToolsAvailable')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Section>
  )
}

const Section = styled.div`
  margin-top: 8px;
  padding-top: 8px;
`

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
  color: var(--color-text-secondary);
`

const SelectableContent = styled.div`
  user-select: text;
  padding: 0 12px;
`

const SwitchContainer = styled.div`
  display: flex;
  gap: 24px;
  align-items: center;
`

const SwitchGroup = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
`

const SwitchLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 80px;
  justify-content: center;
  text-align: center;
`

export default MCPToolsSection
