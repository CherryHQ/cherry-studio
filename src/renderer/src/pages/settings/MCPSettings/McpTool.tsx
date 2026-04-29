import type { ColumnDef } from '@cherrystudio/ui'
import { Badge, ColFlex, DataTable, Flex, InfoTooltip, Switch, Tooltip } from '@cherrystudio/ui'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { McpLogo } from '@renderer/components/Icons'
import type { MCPServer, MCPTool } from '@renderer/types'
import { isToolAutoApproved } from '@renderer/utils/mcp-tools'
import { Zap } from 'lucide-react'
import type { Key } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { McpDetailItem, McpDetailList, RequiredMark } from './McpDetailList'

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
        {prop.description && <p className="m-0 text-foreground-secondary text-sm leading-5">{prop.description}</p>}
        {prop.enum && (
          <div className="mt-1">
            <span className="text-foreground-secondary text-sm">
              {t('settings.mcp.tools.inputSchema.enum.allowedValues')}
            </span>
            <div className="mt-1 flex flex-wrap gap-1">
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
            <div className="mt-1">
              <span className="text-foreground-secondary text-sm italic">items:</span>
              {renderSchemaProperties(prop.items.properties, prop.items.required, depth + 1)}
            </div>
          )}
      </ColFlex>
    )
  }

  // Render a set of schema properties as a read-only detail list
  const renderSchemaProperties = (properties: Record<string, any>, required?: string[], depth: number = 0) => {
    return (
      <McpDetailList className="mt-1 select-text">
        {Object.entries(properties).map(([key, prop]: [string, any]) => (
          <McpDetailItem
            key={key}
            label={
              <Flex className="gap-1">
                <span className="font-medium">{key}</span>
                {required?.includes(key) && (
                  <Tooltip content={t('common.required_field')}>
                    <RequiredMark />
                  </Tooltip>
                )}
              </Flex>
            }>
            {renderPropertyValue(prop, depth)}
          </McpDetailItem>
        ))}
      </McpDetailList>
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
      header: () => <span className="font-medium">{t('settings.mcp.tools.availableTools')}</span>,
      meta: { width: 400, maxWidth: 400 },
      cell: ({ row }) => {
        const tool = row.original

        return (
          <ColFlex className="gap-1">
            <Flex className="items-center gap-1">
              <span className="truncate font-medium text-foreground text-sm" title={tool.name}>
                {tool.name}
              </span>
              <InfoTooltip content={`ID: ${tool.id}`} />
            </Flex>
            {tool.description && (
              <Tooltip content={tool.description}>
                <p className="m-0 line-clamp-1 text-[13px] text-foreground-secondary leading-5">{tool.description}</p>
              </Tooltip>
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
          <span className="font-medium">{t('settings.mcp.tools.enable')}</span>
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
          <span className="font-medium">{t('settings.mcp.tools.autoApprove.label')}</span>
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
