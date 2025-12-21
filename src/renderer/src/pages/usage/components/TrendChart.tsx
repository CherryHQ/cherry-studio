import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import styled from 'styled-components'

type TrendPoint = {
  label: string
  tokens: number
  pricingCost?: number
  providerCost?: number
}

type TrendChartProps = {
  data: TrendPoint[]
  pricingCurrency?: string
  providerCurrency?: string
  formatNumber: (value: number) => string
}

const TrendChart: FC<TrendChartProps> = ({ data, pricingCurrency, providerCurrency, formatNumber }) => {
  const { t } = useTranslation()

  return (
    <ChartContainer>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart
          data={data}
          margin={{
            top: 10,
            right: 24,
            left: 10,
            bottom: 5
          }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="label" stroke="var(--color-text-secondary)" />
          <YAxis yAxisId="tokens" stroke="var(--color-text-secondary)" tickFormatter={(value) => formatNumber(value)} />
          <YAxis
            yAxisId="cost"
            orientation="right"
            stroke="var(--color-text-secondary)"
            tickFormatter={(value) => (value ? formatNumber(value) : '0')}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-background-soft)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)'
            }}
            itemStyle={{ color: 'var(--color-text-primary)' }}
            formatter={(value, name) => {
              if (name === 'tokens') {
                return [formatNumber(value as number), t('usage.metrics.tokens')]
              }
              if (name === 'pricingCost') {
                const currency = pricingCurrency || ''
                return [`${currency}${formatNumber(value as number)}`, t('usage.metrics.cost_pricing')]
              }
              if (name === 'providerCost') {
                const currency = providerCurrency || ''
                return [`${currency}${formatNumber(value as number)}`, t('usage.metrics.cost_api')]
              }
              return [value, name]
            }}
          />
          <Legend />
          <Line type="monotone" yAxisId="tokens" dataKey="tokens" stroke="var(--color-primary)" activeDot={{ r: 6 }} />
          {pricingCurrency && (
            <Line type="monotone" yAxisId="cost" dataKey="pricingCost" stroke="#4aa3df" dot={false} />
          )}
          {providerCurrency && (
            <Line type="monotone" yAxisId="cost" dataKey="providerCost" stroke="#7ddc98" dot={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}

const ChartContainer = styled.div`
  width: 100%;
  height: 350px;
  background: var(--color-background-soft);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--color-border);
`

export default TrendChart
