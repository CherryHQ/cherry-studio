/**
 * Task Plan Execution Analysis
 * Displays analysis of plan execution comparing planned vs actual results
 */

import type { PlanExecutionAnalysis } from '@types'
import { Alert, Progress, Tag } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface TaskPlanAnalysisProps {
  analysis: PlanExecutionAnalysis
}

const Container = styled.div`
  padding: 16px;
  background: var(--color-bg-container);
  border-radius: 8px;
`

const Section = styled.div`
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
`

const SectionTitle = styled.h4`
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--color-text-1);
`

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
`

const MetricCard = styled.div`
  padding: 12px;
  background: var(--color-fill-1);
  border-radius: 6px;
  border: 1px solid var(--color-border);
`

const MetricLabel = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  margin-bottom: 4px;
`

const MetricValue = styled.div<{ $success?: boolean }>`
  font-size: 20px;
  font-weight: 600;
  color: ${(props) => (props.$success ? (props.$success ? 'var(--color-success)' : 'var(--color-error)') : 'var(--color-text-1)')};
`

const SuggestionsList = styled.ul`
  margin: 0;
  padding-left: 20px;
  color: var(--color-text-2);
  font-size: 13px;

  li {
    margin-bottom: 8px;

    &:last-child {
      margin-bottom: 0;
    }
  }
`

const TargetResultItem = styled.div`
  padding: 8px 12px;
  background: var(--color-fill-1);
  border-radius: 4px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;

  &:last-child {
    margin-bottom: 0;
  }
`

const TargetInfo = styled.div`
  flex: 1;
`

const TargetName = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  margin-bottom: 2px;
`

const TargetMeta = styled.div`
  font-size: 11px;
  color: var(--color-text-2);
`

const TaskPlanAnalysis: FC<TaskPlanAnalysisProps> = ({ analysis }) => {
  const { t } = useTranslation()

  const successPercent = Math.round(analysis.successRate * 100)
  const accuracyPercent = Math.round(analysis.durationAccuracy * 100)

  return (
    <Container>
      {/* Success Metrics */}
      <Section>
        <SectionTitle>{t('tasks.analysis.execution_metrics')}</SectionTitle>
        <MetricsGrid>
          <MetricCard>
            <MetricLabel>{t('tasks.analysis.total_targets')}</MetricLabel>
            <MetricValue>{analysis.totalTargets}</MetricValue>
          </MetricCard>
          <MetricCard>
            <MetricLabel>{t('tasks.analysis.success_rate')}</MetricLabel>
            <MetricValue $success={analysis.successRate >= 0.8}>{successPercent}%</MetricValue>
          </MetricCard>
          <MetricCard>
            <MetricLabel>{t('tasks.analysis.duration_accuracy')}</MetricLabel>
            <MetricValue $success={analysis.durationAccuracy >= 0.7}>{accuracyPercent}%</MetricValue>
          </MetricCard>
        </MetricsGrid>
        <Progress
          percent={successPercent}
          strokeColor={analysis.successRate >= 0.8 ? 'var(--color-success)' : 'var(--color-warning)'}
          showInfo={false}
        />
      </Section>

      {/* Duration Comparison */}
      {analysis.totalEstimatedDuration && (
        <Section>
          <SectionTitle>{t('tasks.analysis.duration_comparison')}</SectionTitle>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
            <div>
              <MetricLabel>{t('tasks.analysis.estimated_duration')}</MetricLabel>
              <MetricValue>{analysis.totalEstimatedDuration}s</MetricValue>
            </div>
            <div style={{ fontSize: '20px', color: 'var(--color-text-2)' }}>→</div>
            <div>
              <MetricLabel>{t('tasks.analysis.actual_duration')}</MetricLabel>
              <MetricValue>{(analysis.totalActualDuration / 1000).toFixed(1)}s</MetricValue>
            </div>
            <div>
              <MetricLabel>{t('tasks.analysis.diff')}</MetricLabel>
              <MetricValue $success={analysis.insights.withinEstimatedTime}>
                {(
                  ((analysis.totalActualDuration / 1000 - analysis.totalEstimatedDuration) /
                    analysis.totalEstimatedDuration) *
                  100
                ).toFixed(0)}
                %
              </MetricValue>
            </div>
          </div>
        </Section>
      )}

      {/* Insights and Suggestions */}
      <Section>
        <SectionTitle>{t('tasks.analysis.insights_suggestions')}</SectionTitle>
        {analysis.insights.suggestions.length > 0 ? (
          <SuggestionsList>
            {analysis.insights.suggestions.map((suggestion, index) => (
              <li key={index}>{suggestion}</li>
            ))}
          </SuggestionsList>
        ) : (
          <div style={{ color: 'var(--color-text-2)', fontSize: '13px' }}>{t('tasks.analysis.no_suggestions')}</div>
        )}
      </Section>

      {/* Target Results */}
      <Section>
        <SectionTitle>{t('tasks.analysis.target_results')}</SectionTitle>
        <div>
          {analysis.targetResults.map((result, index) => (
            <TargetResultItem key={index}>
              <TargetInfo>
                <TargetName>
                  {result.target.name}
                  {!result.success && <Tag color="error">失败</Tag>}
                  {result.success && <Tag color="success">成功</Tag>}
                </TargetName>
                <TargetMeta>
                  {result.target.type}
                  {result.estimatedDuration && ` • 预估: ${result.estimatedDuration}s`}
                </TargetMeta>
                {result.error && (
                  <div style={{ fontSize: '12px', color: 'var(--color-error)', marginTop: '4px' }}>{result.error}</div>
                )}
              </TargetInfo>
            </TargetResultItem>
          ))}
        </div>
      </Section>

      {/* Planning Quality */}
      {analysis.planningQuality && (
        <Section>
          <SectionTitle>{t('tasks.analysis.planning_quality')}</SectionTitle>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <Tag color={analysis.planningQuality.confidenceJustified ? 'success' : 'warning'}>
              {analysis.planningQuality.confidenceJustified ? '✓ 置信度合理' : '⚠ 置信度与实际不符'}
            </Tag>
            <Tag color={analysis.planningQuality.dependenciesWorked ? 'success' : 'warning'}>
              {analysis.planningQuality.dependenciesWorked ? '✓ 依赖关系正常' : '⚠ 依赖关系有问题'}
            </Tag>
            {analysis.planningQuality.recommendRuleBased && <Tag color="warning">建议使用规则规划</Tag>}
          </div>
        </Section>
      )}

      {/* Alert if there are failed targets */}
      {analysis.failedTargets > 0 && (
        <Alert
          message={`${analysis.failedTargets} 个目标执行失败`}
          description={analysis.insights.failedTargetNames.join(', ')}
          type="warning"
          showIcon
        />
      )}
    </Container>
  )
}

export default TaskPlanAnalysis
