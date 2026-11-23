import { Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { ColumnDef, DataTableProps } from '@cherrystudio/ui'
import { ColFlex, DataTable, Flex, InfoTooltip, Switch } from '@cherrystudio/ui'
import { McpLogo } from '@renderer/components/icons/SvgIcon'

interface PermissionEntry {
  id: string
  name: string
  description?: string
}

type McpPermissionTableProps<T extends PermissionEntry> = Pick<
  DataTableProps<T>,
  'data' | 'emptyText' | 'expandedRowKeys' | 'onExpandedRowChange' | 'renderExpandedRow' | 'getCanExpand'
> & {
  nameLabel: string
  enableLabel: string
  disabled?: boolean
  isEnabled: (entry: T) => boolean
  onToggleEnabled: (entry: T, enabled: boolean) => void
  renderAutoApprove: (entry: T) => ReactNode
}

export default function McpPermissionTable<T extends PermissionEntry>({
  nameLabel,
  enableLabel,
  disabled,
  isEnabled,
  onToggleEnabled,
  renderAutoApprove,
  ...tableProps
}: McpPermissionTableProps<T>) {
  const { t } = useTranslation()
  const columns: ColumnDef<T>[] = [
    {
      id: 'name',
      header: () => <span className="font-medium">{nameLabel}</span>,
      meta: { width: 400, maxWidth: 400, className: 'overflow-hidden' },
      cell: ({ row: { original: entry } }) => (
        <ColFlex className="min-w-0 gap-1 overflow-hidden">
          <Flex className="min-w-0 items-center gap-1">
            <span className="truncate text-foreground text-sm" title={entry.name}>
              {entry.name}
            </span>
            <InfoTooltip content={`ID: ${entry.id}`} />
          </Flex>
          {entry.description && (
            <p className="m-0 line-clamp-1 w-full min-w-0 max-w-full overflow-hidden text-[13px] text-muted-foreground leading-5">
              {entry.description}
            </p>
          )}
        </ColFlex>
      )
    },
    {
      id: 'enable',
      header: () => (
        <Flex className="items-center justify-center gap-1">
          <McpLogo width={14} height={14} style={{ opacity: 0.8 }} />
          <span className="font-medium">{enableLabel}</span>
        </Flex>
      ),
      meta: { width: 150, maxWidth: 150, align: 'center' },
      cell: ({ row: { original: entry } }) => (
        <Switch
          size="xs"
          aria-label={`${enableLabel}: ${entry.name}`}
          checked={isEnabled(entry)}
          disabled={disabled}
          onCheckedChange={(checked) => onToggleEnabled(entry, checked)}
        />
      )
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
      cell: ({ row }) => renderAutoApprove(row.original)
    }
  ]

  return (
    <DataTable
      {...tableProps}
      columns={columns}
      rowKey="id"
      tableLayout="fixed"
      className="bg-transparent [&_[data-slot=table-cell]]:bg-transparent [&_[data-slot=table-head]]:bg-transparent [&_[data-slot=table-header]]:bg-transparent [&_[data-slot=table-header]_[data-slot=table-row]]:bg-transparent"
      rowClassName="bg-transparent"
    />
  )
}
