import { getProviderNameById } from '@renderer/services/ProviderService'
import type { UsageGroupRow } from '@renderer/services/usage/UsageAnalyticsService'
import { Button, Table, type TableColumnsType } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type StatsTableProps = {
  title: string
  rows: UsageGroupRow[]
  variant: 'module' | 'model'
  formatNumber: (value: number) => string
  formatCurrencyMap: (map: Record<string, number>) => string
  onOpen?: (row: UsageGroupRow) => void
}

const StatsTable: FC<StatsTableProps> = ({ title, rows, variant, formatNumber, formatCurrencyMap, onOpen }) => {
  const { t } = useTranslation()
  const columns: TableColumnsType<UsageGroupRow> = [
    {
      title: variant === 'module' ? t('usage.table.module') : t('usage.table.model'),
      dataIndex: 'label',
      render: (value) => value || t('usage.unknown')
    }
  ]

  if (variant === 'model') {
    columns.splice(1, 0, {
      title: t('usage.table.provider'),
      dataIndex: 'providerId',
      render: (value) => (value ? getProviderNameById(value) : t('usage.unknown'))
    })
  }

  columns.push(
    {
      title: t('usage.table.tokens'),
      dataIndex: ['totals', 'totalTokens'],
      defaultSortOrder: 'descend',
      sorter: (a, b) => (a.totals.totalTokens || 0) - (b.totals.totalTokens || 0),
      render: (value) => formatNumber(value || 0)
    },
    {
      title: t('usage.table.cost_api'),
      dataIndex: ['totals', 'costProviderByCurrency'],
      render: (value) => formatCurrencyMap(value || {})
    },
    {
      title: t('usage.table.cost_pricing'),
      dataIndex: ['totals', 'costPricingByCurrency'],
      render: (value) => formatCurrencyMap(value || {})
    },
    {
      title: t('usage.table.images'),
      dataIndex: ['totals', 'imageCount'],
      render: (value) => formatNumber(value || 0)
    },
    {
      title: t('usage.table.events'),
      dataIndex: ['totals', 'eventCount'],
      render: (value) => formatNumber(value || 0)
    }
  )

  if (onOpen) {
    columns.push({
      title: '',
      dataIndex: 'action',
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => onOpen(row)}>
          {t('usage.table.open')}
        </Button>
      )
    })
  }

  return (
    <TableContainer>
      <Table<UsageGroupRow>
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 10, size: 'small', hideOnSinglePage: true }}
        size="middle"
        title={() => title}
      />
    </TableContainer>
  )
}

const TableContainer = styled.div`
  background: var(--color-background-soft);
  border-radius: 8px;
  padding: 16px;
  border: 1px solid var(--color-border);
`

export default StatsTable
