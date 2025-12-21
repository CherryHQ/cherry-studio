import type { UsageTotals } from '@renderer/services/usage/UsageAnalyticsService'
import { Card, Col, Row, Statistic } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

type KPICardsProps = {
  totals: UsageTotals
  formatNumber: (value: number) => string
  formatCurrencyMap: (map: Record<string, number>) => string
}

const KPICards: FC<KPICardsProps> = ({ totals, formatNumber, formatCurrencyMap }) => {
  const { t } = useTranslation()
  const tokenValue = formatNumber(totals.totalTokens)
  const providerCost = formatCurrencyMap(totals.costProviderByCurrency)
  const pricingCost = formatCurrencyMap(totals.costPricingByCurrency)
  const images = formatNumber(totals.imageCount)

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={24} sm={12} lg={6}>
        <Card bordered={false} style={{ height: '100%', background: 'var(--color-background-soft)' }}>
          <Statistic
            title={t('usage.kpi.tokens')}
            value={tokenValue}
            valueStyle={{ color: 'var(--color-text-primary)' }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card bordered={false} style={{ height: '100%', background: 'var(--color-background-soft)' }}>
          <Statistic
            title={t('usage.kpi.cost_api')}
            value={providerCost}
            valueStyle={{ color: 'var(--color-text-primary)' }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card bordered={false} style={{ height: '100%', background: 'var(--color-background-soft)' }}>
          <Statistic
            title={t('usage.kpi.cost_pricing')}
            value={pricingCost}
            valueStyle={{ color: 'var(--color-text-primary)' }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card bordered={false} style={{ height: '100%', background: 'var(--color-background-soft)' }}>
          <Statistic title={t('usage.kpi.images')} value={images} valueStyle={{ color: 'var(--color-text-primary)' }} />
        </Card>
      </Col>
    </Row>
  )
}

export default KPICards
