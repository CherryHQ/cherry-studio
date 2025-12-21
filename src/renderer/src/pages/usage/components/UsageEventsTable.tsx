import { getProviderNameById } from '@renderer/services/ProviderService'
import type { UsageEvent } from '@renderer/types'
import { Button, Table, type TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { getUsageModuleLabelKey, getUsageOperationLabelKey } from '../usageI18n'

type UsageEventsTableProps = {
  events: UsageEvent[]
  formatNumber: (value: number) => string
  isOpenable: (event: UsageEvent) => boolean
  onOpen: (event: UsageEvent) => void
}

const formatCurrencyAmount = (currency?: string, amount?: number) => {
  if (amount === undefined) {
    return '-'
  }
  const prefix = currency || ''
  return `${prefix}${amount.toFixed(4)}`
}

const UsageEventsTable: FC<UsageEventsTableProps> = ({ events, formatNumber, isOpenable, onOpen }) => {
  const { t } = useTranslation()

  const columns: TableColumnsType<UsageEvent> = [
    {
      title: t('usage.table.time'),
      dataIndex: 'occurredAt',
      render: (value) => dayjs(value).format('YYYY-MM-DD HH:mm')
    },
    {
      title: t('usage.table.module'),
      dataIndex: 'module',
      render: (value: UsageEvent['module']) => (value ? t(getUsageModuleLabelKey(value)) : t('usage.unknown'))
    },
    {
      title: t('usage.table.operation'),
      dataIndex: 'operation',
      render: (value: UsageEvent['operation']) => (value ? t(getUsageOperationLabelKey(value)) : t('usage.unknown'))
    },
    {
      title: t('usage.table.provider'),
      dataIndex: 'providerId',
      render: (value) => (value ? getProviderNameById(value) : t('usage.unknown'))
    },
    {
      title: t('usage.table.model'),
      dataIndex: 'modelName',
      render: (_, record) => record.modelName || record.modelId || t('usage.unknown')
    },
    {
      title: t('usage.table.tokens'),
      dataIndex: 'totalTokens',
      render: (_, record) => formatNumber(record.totalTokens ?? 0)
    },
    {
      title: t('usage.table.cost_api'),
      dataIndex: 'costProvider',
      render: (_, record) => formatCurrencyAmount(record.currencyProvider, record.costProvider)
    },
    {
      title: t('usage.table.cost_pricing'),
      dataIndex: 'costPricing',
      render: (_, record) => formatCurrencyAmount(record.currencyPricing, record.costPricing)
    },
    {
      title: t('usage.table.images'),
      dataIndex: 'imageCount',
      render: (_, record) => formatNumber(record.imageCount ?? 0)
    },
    {
      title: '',
      dataIndex: 'action',
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => onOpen(record)} disabled={!isOpenable(record)}>
          {t('usage.table.open')}
        </Button>
      )
    }
  ]

  return (
    <TableContainer>
      <Table<UsageEvent>
        columns={columns}
        dataSource={events}
        pagination={{ pageSize: 20, size: 'small' }}
        size="middle"
        rowKey={(record) => record.id}
        title={() => t('usage.table.recent')}
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

export default UsageEventsTable
