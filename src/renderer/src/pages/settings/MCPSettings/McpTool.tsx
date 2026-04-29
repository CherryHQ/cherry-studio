import type { ColumnDef } from '@cherrystudio/ui'
import { Badge, ColFlex, DataTable, Flex, InfoTooltip, Switch, Tooltip } from '@cherrystudio/ui'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { McpLogo } from '@renderer/components/Icons'
import type { MCPServer, MCPTool } from '@renderer/types'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
import { Descriptions, Typography } from 'antd'
import { Zap } from 'lucide-react'
import type { Key } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface MCPToolsSectionProps {
  tools: MCPTool[]
  server: MCPServer
  onToggleTool: (tool: MCPTool, enabled: boolean) => void
  onToggleAutoApprove: (tool: MCPTool, autoApprove: boolean) => void
}

const MCPToolsSection = ({ tools, server, onToggleTool, onToggleAutoApprove }: MCPToolsSectionProps) => {
  const { t } = useTranslation()
  const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>([])
  const [searchText, setSearchText] = useState('')

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

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'string':
        return 'border-primary/30 bg-primary/10 text-primary'
      case 'number':
        return 'border-success/30 bg-success/10 text-success'
      case 'boolean':
        return 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400'
      case 'object':
        return 'border-warning/30 bg-warning/10 text-warning'
      case 'array':
        return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
      default:
        return 'border-border bg-background-subtle text-foreground'
    }
  }

  const MAX_NESTING_DEPTH = 5

  // Render a single property's value (type badge, description, enum, nested properties)
  const renderPropertyValue = (prop: any, depth: number = 0) => {
    const itemType = prop.type === 'array' && prop.items?.type ? `${prop.items.type}[]` : prop.type

    return (
      <ColFlex className="gap-1">
        <Flex className="items-center gap-2">
          {itemType && <Badge className={getTypeBadgeClass(prop.type)}>{itemType}</Badge>}
        </Flex>
        {prop.description && (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
            {prop.description}
          </Typography.Paragraph>
        )}
        {prop.enum && (
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="secondary">{t('settings.mcp.tools.inputSchema.enum.allowedValues')}</Typography.Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {prop.enum.map((value: string, idx: number) => (
                <Badge key={idx} variant="outline">
                  {value}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {depth < MAX_NESTING_DEPTH &&
          prop.type === 'object' &&
          prop.properties &&
          renderSchemaProperties(prop.properties, prop.required, depth + 1)}
        {depth < MAX_NESTING_DEPTH &&
          prop.type === 'array' &&
          prop.items?.type === 'object' &&
          prop.items.properties && (
            <div style={{ marginTop: 4 }}>
              <Typography.Text type="secondary" italic>
                items:
              </Typography.Text>
              {renderSchemaProperties(prop.items.properties, prop.items.required, depth + 1)}
            </div>
          )}
      </ColFlex>
    )
  }

  // Render a set of schema properties as a Descriptions list
  const renderSchemaProperties = (properties: Record<string, any>, required?: string[], depth: number = 0) => {
    return (
      <Descriptions bordered size="small" column={1} style={{ userSelect: 'text', marginTop: 4 }}>
        {Object.entries(properties).map(([key, prop]: [string, any]) => (
          <Descriptions.Item
            key={key}
            label={
              <Flex className="gap-1">
                <Typography.Text strong>{key}</Typography.Text>
                {required?.includes(key) && (
                  <Tooltip title={t('common.required_field')}>
                    <span style={{ color: '#f5222d' }}>*</span>
                  </Tooltip>
                )}
              </Flex>
            }>
            {renderPropertyValue(prop, depth)}
          </Descriptions.Item>
        ))}
      </Descriptions>
    )
  }

  // Render tool properties from the input schema
  const renderToolProperties = (tool: MCPTool) => {
    if (!tool.inputSchema?.properties) return null
    return renderSchemaProperties(tool.inputSchema.properties, tool.inputSchema.required)
  }

  const filteredTools = useMemo(() => {
    const query = searchText.trim().toLowerCase()

    if (!query) {
      return tools
    }

    return tools.filter((tool) =>
      [tool.name, tool.id, tool.description].some((value) => value?.toLowerCase().includes(query))
    )
  }, [searchText, tools])

  const columns: ColumnDef<MCPTool>[] = [
    {
      id: 'name',
      header: () => <Typography.Text strong>{t('settings.mcp.tools.availableTools')}</Typography.Text>,
      meta: { width: 400, maxWidth: 400 },
      cell: ({ row }) => {
        const tool = row.original

        return (
          <ColFlex className="gap-1">
            <Flex className="items-center gap-1">
              <Typography.Text strong ellipsis={{ tooltip: tool.name }}>
                {tool.name}
              </Typography.Text>
              <InfoTooltip content={`ID: ${tool.id}`} />
            </Flex>
            {tool.description && (
              <Typography.Paragraph
                type="secondary"
                style={{ fontSize: '13px' }}
                ellipsis={{ rows: 1, expandable: true }}>
                {tool.description}
              </Typography.Paragraph>
            )}
          </ColFlex>
        )
      }
    },
    {
      id: 'enable',
      header: () => (
        <Flex className="items-center justify-center gap-1">
          <McpLogo width={14} height={14} style={{ opacity: 0.8 }} />
          <Typography.Text strong>{t('settings.mcp.tools.enable')}</Typography.Text>
        </Flex>
      ),
      meta: { width: 150, maxWidth: 150, align: 'center' },
      cell: ({ row }) => {
        const tool = row.original

        return <Switch checked={isToolEnabled(tool)} onCheckedChange={(checked) => handleToggle(tool, checked)} />
      }
    },
    {
      id: 'autoApprove',
      header: () => (
        <Flex className="items-center justify-center gap-1">
          <Zap size={14} color="red" />
          <Typography.Text strong>{t('settings.mcp.tools.autoApprove.label')}</Typography.Text>
        </Flex>
      ),
      meta: { width: 150, maxWidth: 150, align: 'center' },
      cell: ({ row }) => {
        const tool = row.original

        return (
          <Tooltip
            content={
              !isToolEnabled(tool)
                ? t('settings.mcp.tools.autoApprove.tooltip.howToEnable')
                : isToolAutoApproved(tool, server)
                  ? t('settings.mcp.tools.autoApprove.tooltip.enabled')
                  : t('settings.mcp.tools.autoApprove.tooltip.disabled')
            }>
            <Switch
              checked={isToolAutoApproved(tool, server)}
              disabled={!isToolEnabled(tool)}
              onCheckedChange={(checked) => handleAutoApproveToggle(tool, checked)}
            />
          </Tooltip>
        )
      }
    }
  ]

  return (
    <DataTable
      data={filteredTools}
      columns={columns}
      rowKey="id"
      emptyText={searchText ? t('common.no_results') : t('settings.mcp.tools.noToolsAvailable')}
      headerRight={
        tools.length > 0 ? (
          <CollapsibleSearchBar
            onSearch={setSearchText}
            placeholder={t('common.search')}
            tooltip={t('common.search')}
            maxWidth={200}
            style={{ borderRadius: 20 }}
          />
        ) : undefined
      }
      expandedRowKeys={expandedRowKeys}
      onExpandedRowChange={setExpandedRowKeys}
      renderExpandedRow={(tool) => renderToolProperties(tool)}
      getCanExpand={(tool) => Boolean(tool.inputSchema?.properties)}
    />
  )
}

export default MCPToolsSection
