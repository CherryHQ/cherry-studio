import '@cherrystudio/ui/components/composites/markdown/styles'
import { Zap } from 'lucide-react'
import type { Key } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ColumnDef } from '@cherrystudio/ui'
import { Badge, ColFlex, DataTable, Flex, InfoTooltip, Markdown, RequiredMark, Switch, Tooltip } from '@cherrystudio/ui'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import { useIsToolAutoApproved } from '@renderer/hooks/useMcpServer'
import type { McpTool } from '@renderer/types/tool'
import type { McpServer } from '@shared/data/types/mcpServer'

interface McpToolsSectionProps {
  tools: McpTool[]
  server: McpServer
  searchText: string
  onToggleTool: (tool: McpTool, enabled: boolean) => void
  onToggleAutoApprove: (tool: McpTool, autoApprove: boolean) => void
}

const MAX_NESTING_DEPTH = 5

type SchemaProperties = NonNullable<McpTool['inputSchema']['properties']>

type SchemaProperty = SchemaProperties[string]

const getToolSchemaProperties = (tool: McpTool) => tool.inputSchema?.properties

const AutoApproveCell = ({
  tool,
  enabled,
  onToggle
}: {
  tool: McpTool
  enabled: boolean
  onToggle: (tool: McpTool, autoApprove: boolean) => void
}) => {
  const { t } = useTranslation()
  const isAutoApproved = useIsToolAutoApproved(tool)

  return (
    <Tooltip
      content={
        !enabled
          ? t('settings.mcp.tools.autoApprove.tooltip.howToEnable')
          : isAutoApproved
            ? t('settings.mcp.tools.autoApprove.tooltip.enabled')
            : t('settings.mcp.tools.autoApprove.tooltip.disabled')
      }>
      <Switch
        size="xs"
        checked={isAutoApproved}
        disabled={!enabled}
        onCheckedChange={(checked) => onToggle(tool, checked)}
      />
    </Tooltip>
  )
}

const McpToolsSection = ({ tools, server, searchText, onToggleTool, onToggleAutoApprove }: McpToolsSectionProps) => {
  const { t } = useTranslation()
  const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>([])

  // Check if a tool is enabled (not in the disabledTools array)
  const isToolEnabled = (tool: McpTool) => {
    return !server.disabledTools?.includes(tool.name)
  }

  // Handle tool toggle
  const handleToggle = (tool: McpTool, checked: boolean) => {
    onToggleTool(tool, checked)
  }

  // Handle auto-approve toggle
  const handleAutoApproveToggle = (tool: McpTool, checked: boolean) => {
    onToggleAutoApprove(tool, checked)
  }

  const getTypeBadgeClass = (type: string | undefined) => {
    switch (type) {
      case 'string':
        return 'border-primary/30 bg-primary/10 text-primary'
      case 'number':
        return 'border-success-border bg-success-subtle text-success-subtle-foreground'
      case 'boolean':
        return 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400'
      case 'object':
        return 'border-warning-border bg-warning-subtle text-warning-subtle-foreground'
      case 'array':
        return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
      default:
        return 'border-border bg-background-subtle text-foreground'
    }
  }

  // Render a single schema property and its nested children as a tree node.
  const renderProperty = (key: string, property: SchemaProperty, required: boolean, depth: number = 0) => {
    const fields = property !== null && typeof property === 'object' && !Array.isArray(property) ? property : undefined

    const type =
      typeof fields?.type === 'string'
        ? fields.type
        : Array.isArray(fields?.type)
          ? fields.type.filter((value) => typeof value === 'string')
          : undefined

    const description = typeof fields?.description === 'string' ? fields.description : undefined

    const items =
      fields?.items !== null && typeof fields?.items === 'object' && !Array.isArray(fields.items)
        ? fields.items
        : undefined

    const itemsType =
      typeof items?.type === 'string'
        ? items.type
        : Array.isArray(items?.type)
          ? items.type.filter((value) => typeof value === 'string')
          : undefined

    const itemType = type === 'array' && itemsType ? `${itemsType}[]` : type
    const enumValues = Array.isArray(fields?.enum) ? fields.enum : undefined

    const properties =
      fields?.properties !== null && typeof fields?.properties === 'object' && !Array.isArray(fields.properties)
        ? fields.properties
        : undefined

    const itemProperties =
      items?.properties !== null && typeof items?.properties === 'object' && !Array.isArray(items.properties)
        ? items.properties
        : undefined

    return (
      <div key={key} data-schema-property={key} className="min-w-0 border-border border-b py-2 last:border-b-0">
        <Flex className="min-w-0 items-start gap-2">
          <Flex className="w-40 shrink-0 items-center gap-1">
            <span className="wrap-anywhere min-w-0 font-semibold">{key}</span>
            {required && (
              <Tooltip content={t('common.required_field')}>
                <RequiredMark />
              </Tooltip>
            )}
          </Flex>
          {itemType && (
            <Badge className={`shrink-0 ${getTypeBadgeClass(typeof type === 'string' ? type : undefined)}`}>
              {itemType}
            </Badge>
          )}
          {description && (
            <span className="wrap-break-word min-w-0 flex-1 text-muted-foreground text-sm leading-5">
              {description}
            </span>
          )}
        </Flex>
        {enumValues && (
          <div className="mt-1 ml-42 flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-sm">
              {t('settings.mcp.tools.inputSchema.enum.allowedValues')}
            </span>
            {enumValues.map((enumValue, index) => (
              <Badge key={index} variant="outline">
                {String(enumValue)}
              </Badge>
            ))}
          </div>
        )}
        {depth < MAX_NESTING_DEPTH &&
          type === 'object' &&
          properties &&
          renderSchemaProperties(properties, Array.isArray(fields?.required) ? fields.required : undefined, depth + 1)}
        {depth < MAX_NESTING_DEPTH && type === 'array' && itemsType === 'object' && itemProperties && (
          <div className="mt-2">
            <span className="text-muted-foreground text-sm italic">items:</span>
            {renderSchemaProperties(
              itemProperties,
              Array.isArray(items?.required) ? items.required : undefined,
              depth + 1
            )}
          </div>
        )}
      </div>
    )
  }

  const renderSchemaProperties = (
    properties: SchemaProperties,
    required: readonly SchemaProperty[] = [],
    depth: number = 0
  ) => {
    return (
      <div
        className={
          depth === 0
            ? 'mt-1 min-w-0 select-text overflow-hidden rounded-md border border-border bg-background px-3'
            : 'mt-2 ml-3 min-w-0 select-text border-border border-l pl-3'
        }>
        {Object.entries(properties).map(([key, property]) =>
          renderProperty(key, property, required.includes(key), depth)
        )}
      </div>
    )
  }

  const renderToolProperties = (tool: McpTool) => {
    const properties = getToolSchemaProperties(tool)
    const hasInputSchema = Boolean(properties && Object.keys(properties).length > 0)

    if (!tool.description && !hasInputSchema) return null

    return (
      <ColFlex className="gap-4">
        {tool.description && (
          <div>
            <h4 className="mb-2 font-bold text-foreground text-sm">{t('common.description')}</h4>
            <Markdown
              id={`mcp-tool-description-${tool.id}`}
              footnoteLabel={t('common.footnotes')}
              className="font-normal text-muted-foreground text-sm">
              {tool.description}
            </Markdown>
          </div>
        )}
        {hasInputSchema && properties && (
          <div>
            <h4 className="mb-2 font-bold text-foreground text-sm">{t('settings.mcp.tools.inputSchema.label')}</h4>
            {renderSchemaProperties(properties, tool.inputSchema.required)}
          </div>
        )}
      </ColFlex>
    )
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

  const columns: ColumnDef<McpTool>[] = [
    {
      id: 'name',
      header: () => <span className="font-medium">{t('settings.mcp.tools.availableTools')}</span>,
      meta: { width: 400, maxWidth: 400, className: 'overflow-hidden' },
      cell: ({ row }) => {
        const tool = row.original

        return (
          <ColFlex className="min-w-0 gap-1 overflow-hidden">
            <Flex className="min-w-0 items-center gap-1">
              <span className="truncate text-foreground text-sm" title={tool.name}>
                {tool.name}
              </span>
              <InfoTooltip content={`ID: ${tool.id}`} />
            </Flex>
            {tool.description && (
              <p className="m-0 line-clamp-1 w-full min-w-0 max-w-full overflow-hidden text-[13px] text-muted-foreground leading-5">
                {tool.description}
              </p>
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

        return (
          <Switch size="xs" checked={isToolEnabled(tool)} onCheckedChange={(checked) => handleToggle(tool, checked)} />
        )
      }
    },
    {
      id: 'autoApprove',
      header: () => (
        <Flex className="items-center justify-center gap-1">
          <Zap size={14} color="var(--error)" />
          <span className="font-medium">{t('settings.mcp.tools.autoApprove.label')}</span>
        </Flex>
      ),
      meta: { width: 150, maxWidth: 150, align: 'center' },
      cell: ({ row }) => (
        <AutoApproveCell tool={row.original} enabled={isToolEnabled(row.original)} onToggle={handleAutoApproveToggle} />
      )
    }
  ]

  return (
    <DataTable
      data={filteredTools}
      columns={columns}
      rowKey="id"
      emptyText={searchText ? t('common.no_results') : t('settings.mcp.tools.noToolsAvailable')}
      expandedRowKeys={expandedRowKeys}
      onExpandedRowChange={setExpandedRowKeys}
      renderExpandedRow={(tool) => renderToolProperties(tool)}
      getCanExpand={(tool) => {
        const properties = getToolSchemaProperties(tool)

        return Boolean(tool.description) || Boolean(properties && Object.keys(properties).length)
      }}
      tableLayout="fixed"
      className="bg-transparent [&_[data-slot=table-cell]]:bg-transparent [&_[data-slot=table-head]]:bg-transparent [&_[data-slot=table-header]]:bg-transparent [&_[data-slot=table-header]_[data-slot=table-row]]:bg-transparent"
      rowClassName="bg-transparent"
    />
  )
}

export default McpToolsSection
