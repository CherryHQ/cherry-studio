import type { UsageBucket } from '@renderer/services/usage/UsageAnalyticsService'
import type { UsageCategory, UsageModule } from '@renderer/types'
import { Button, DatePicker, Radio, Select, type SelectProps, Space } from 'antd'
import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { RangePicker } = DatePicker

type FilterBarProps = {
  range: [Dayjs | null, Dayjs | null] | null
  onRangeChange: (range: [Dayjs | null, Dayjs | null] | null) => void
  bucket: UsageBucket
  onBucketChange: (bucket: UsageBucket) => void
  moduleOptions: SelectProps['options']
  categoryOptions: SelectProps['options']
  providerOptions: SelectProps['options']
  modelOptions: SelectProps['options']
  selectedModules: UsageModule[]
  selectedCategories: UsageCategory[]
  selectedProviders: string[]
  selectedModels: string[]
  onModulesChange: (value: UsageModule[]) => void
  onCategoriesChange: (value: UsageCategory[]) => void
  onProvidersChange: (value: string[]) => void
  onModelsChange: (value: string[]) => void
  onReset: () => void
}

const FilterBar: FC<FilterBarProps> = ({
  range,
  onRangeChange,
  bucket,
  onBucketChange,
  moduleOptions,
  categoryOptions,
  providerOptions,
  modelOptions,
  selectedModules,
  selectedCategories,
  selectedProviders,
  selectedModels,
  onModulesChange,
  onCategoriesChange,
  onProvidersChange,
  onModelsChange,
  onReset
}) => {
  const { t } = useTranslation()

  return (
    <Container>
      <Space wrap>
        <RangePicker value={range || null} onChange={onRangeChange} style={{ width: 260 }} />
        <Radio.Group value={bucket} buttonStyle="solid" onChange={(e) => onBucketChange(e.target.value as UsageBucket)}>
          <Radio.Button value="day">{t('usage.filters.bucket.day')}</Radio.Button>
          <Radio.Button value="week">{t('usage.filters.bucket.week')}</Radio.Button>
          <Radio.Button value="month">{t('usage.filters.bucket.month')}</Radio.Button>
        </Radio.Group>
        <Select
          mode="multiple"
          allowClear
          placeholder={t('usage.filters.category')}
          style={{ width: 200 }}
          options={categoryOptions}
          value={selectedCategories}
          onChange={(value) => onCategoriesChange(value as UsageCategory[])}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder={t('usage.filters.module')}
          style={{ width: 200 }}
          options={moduleOptions}
          value={selectedModules}
          onChange={(value) => onModulesChange(value as UsageModule[])}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder={t('usage.filters.provider')}
          style={{ width: 220 }}
          options={providerOptions}
          value={selectedProviders}
          onChange={(value) => onProvidersChange(value as string[])}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder={t('usage.filters.model')}
          style={{ width: 260 }}
          options={modelOptions}
          value={selectedModels}
          onChange={(value) => onModelsChange(value as string[])}
        />
        <Button onClick={onReset}>{t('usage.filters.reset')}</Button>
      </Space>
    </Container>
  )
}

const Container = styled.div`
  padding: 16px;
  background: var(--color-background-soft);
  border-radius: 8px;
  margin-bottom: 16px;
  border: 1px solid var(--color-border);
`

export default FilterBar
