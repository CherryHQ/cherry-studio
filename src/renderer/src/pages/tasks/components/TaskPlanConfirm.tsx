/**
 * Task Plan Confirmation Popup
 * Displays the AI-generated execution plan and allows user to confirm before execution
 */

import TaskPlanFlowDiagram from '@renderer/pages/tasks/components/TaskPlanFlowDiagram'
import type { TaskExecutionPlan } from '@types'
import { Button, Modal, Tag, Timeline } from 'antd'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface TaskPlanConfirmProps {
  open: boolean
  plan: TaskExecutionPlan | null
  taskName: string
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

const Container = styled.div`
  max-height: 600px;
  overflow-y: auto;
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

const PlanSummary = styled.div`
  padding: 12px;
  background: var(--color-primary-bg);
  border-left: 3px solid var(--color-primary);
  border-radius: 4px;
  margin-bottom: 16px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-1);
`

const MetadataRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);

  &:last-child {
    border-bottom: none;
  }
`

const MetadataLabel = styled.span`
  font-size: 13px;
  color: var(--color-text-2);
`

const MetadataValue = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
`

const TargetBadge = styled.div`
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  background: var(--color-fill-1);
  border-radius: 4px;
  margin-right: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--color-text-1);

  .index {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: var(--color-primary);
    color: var(--color-primary-text);
    border-radius: 50%;
    font-size: 11px;
    font-weight: 600;
    margin-right: 8px;
  }
`

const ReasonText = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  margin-top: 4px;
  padding-left: 28px;
`

const ConfidenceMeter = styled.div<{ confidence: number }>`
  width: 100%;
  height: 6px;
  background: var(--color-fill-2);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 8px;

  &::after {
    content: '';
    display: block;
    width: ${(props) => props.confidence * 100}%;
    height: 100%;
    background: ${(props) => {
      const c = props.confidence
      if (c >= 0.8) return 'var(--color-success)'
      if (c >= 0.6) return 'var(--color-primary)'
      if (c >= 0.4) return 'var(--color-warning)'
      return 'var(--color-error)'
    }};
    transition: width 0.3s ease;
  }
`

const TimelineContainer = styled.div`
  padding-left: 8px;

  .ant-timeline-item-content {
    color: var(--color-text-1);
  }
`

const TimelineItem = styled(Timeline.Item)`
  .ant-timeline-item-content {
    margin-left: 8px;
  }

  .ant-timeline-item-tail {
    border-color: var(--color-border);
  }
`

const EmptyState = styled.div`
  text-align: center;
  padding: 32px;
  color: var(--color-text-2);
`

const TaskPlanConfirm: FC<TaskPlanConfirmProps> = ({ open, plan, taskName, onConfirm, onCancel, loading = false }) => {
  const { t } = useTranslation()

  const confidenceColor = useMemo(() => {
    if (!plan?.planningMetadata) return undefined
    const c = plan.planningMetadata.confidence
    if (c >= 0.8) return 'var(--color-success)'
    if (c >= 0.6) return 'var(--color-primary)'
    if (c >= 0.4) return 'var(--color-warning)'
    return 'var(--color-error)'
  }, [plan])

  const confidenceText = useMemo(() => {
    if (!plan?.planningMetadata) return ''
    const c = plan.planningMetadata.confidence
    if (c >= 0.8) return t('tasks.planning.confidence.high')
    if (c >= 0.6) return t('tasks.planning.confidence.medium')
    if (c >= 0.4) return t('tasks.planning.confidence.low')
    return t('tasks.planning.confidence.very_low')
  }, [plan, t])

  if (!plan) {
    return (
      <Modal open={open} title={t('tasks.planning.title')} onCancel={onCancel} footer={null} width={600}>
        <EmptyState>{t('tasks.planning.no_plan')}</EmptyState>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      title={
        <div>
          {t('tasks.planning.title')} - {taskName}
        </div>
      }
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={loading}>
          {t('common.cancel')}
        </Button>,
        <Button key="confirm" type="primary" onClick={onConfirm} loading={loading}>
          {t('tasks.planning.confirm_execute')}
        </Button>
      ]}
      width={900}>
      <Container>
        {/* Plan Summary */}
        {plan.summary && (
          <Section>
            <PlanSummary>{plan.summary}</PlanSummary>
          </Section>
        )}

        {/* Flow Diagram Visualization */}
        <Section>
          <SectionTitle>{t('tasks.planning.flow_diagram')}</SectionTitle>
          <TaskPlanFlowDiagram plan={plan} />
        </Section>

        {/* Planning Metadata */}
        {plan.planningMetadata && (
          <Section>
            <SectionTitle>{t('tasks.planning.metadata_title')}</SectionTitle>
            <MetadataRow>
              <MetadataLabel>{t('tasks.planning.model_used')}</MetadataLabel>
              <MetadataValue>
                <Tag>{plan.planningMetadata.modelUsed}</Tag>
              </MetadataValue>
            </MetadataRow>
            <MetadataRow>
              <MetadataLabel>{t('tasks.planning.confidence.label')}</MetadataLabel>
              <MetadataValue>
                <span style={{ color: confidenceColor, fontWeight: 600 }}>
                  {Math.round(plan.planningMetadata.confidence * 100)}% - {confidenceText}
                </span>
                <ConfidenceMeter confidence={plan.planningMetadata.confidence} />
              </MetadataValue>
            </MetadataRow>
            <MetadataRow>
              <MetadataLabel>{t('tasks.planning.estimated_duration')}</MetadataLabel>
              <MetadataValue>
                {plan.planningMetadata.estimatedDuration} {t('common.seconds')}
              </MetadataValue>
            </MetadataRow>
            {plan.planningMetadata.reasoning && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--color-fill-1)', borderRadius: 4 }}>
                <MetadataLabel>{t('tasks.planning.reasoning')}:</MetadataLabel>
                <p style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-2)' }}>
                  {plan.planningMetadata.reasoning}
                </p>
              </div>
            )}
          </Section>
        )}

        {/* Parallel Groups */}
        {plan.parallelGroups.length > 0 && (
          <Section>
            <SectionTitle>
              {t('tasks.planning.parallel_groups')} ({plan.parallelGroups.length})
            </SectionTitle>
            {plan.parallelGroups.map((group, groupIndex) => (
              <div
                key={`parallel-${groupIndex}`}
                style={{
                  marginBottom: groupIndex < plan.parallelGroups.length - 1 ? '16px' : 0,
                  padding: '12px',
                  background: 'var(--color-success-bg)',
                  border: '1px solid var(--color-success-border)',
                  borderRadius: 6
                }}>
                <div style={{ marginBottom: 8 }}>
                  <Tag color="green">{t('tasks.planning.parallel')}</Tag>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{group.description}</span>
                </div>
                <div>
                  {group.targets.map((target, targetIndex) => (
                    <TargetBadge key={`${groupIndex}-${targetIndex}`}>
                      <span className="index">{targetIndex + 1}</span>
                      <span>{target.name}</span>
                      <Tag style={{ marginLeft: 8 }} color="geekblue">
                        {target.type}
                      </Tag>
                    </TargetBadge>
                  ))}
                </div>
                {group.reason && <ReasonText>{group.reason}</ReasonText>}
                {group.estimatedDuration && (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-2)' }}>
                    ⏱️ {t('tasks.planning.estimated_duration')}: {group.estimatedDuration}s
                  </div>
                )}
              </div>
            ))}
          </Section>
        )}

        {/* Sequential Steps */}
        {plan.steps.length > 0 && (
          <Section>
            <SectionTitle>
              {t('tasks.planning.sequential_steps')} ({plan.steps.length})
            </SectionTitle>
            <TimelineContainer>
              <Timeline mode="left">
                {/* Smart Planning Step */}
                {plan.planningMetadata && (
                  <TimelineItem
                    key="planning-step"
                    color="blue"
                    label={<span style={{ fontSize: 12, fontWeight: 600 }}>Step 0</span>}>
                    <div>
                      <TargetBadge>
                        <span className="index">0</span>
                        <span>{t('tasks.planning.planning_phase')}</span>
                        <Tag style={{ marginLeft: 8 }} color="cyan">
                          AI
                        </Tag>
                      </TargetBadge>
                      <ReasonText>{t('tasks.planning.planning_phase_desc')}</ReasonText>
                      {plan.planningMetadata.planningTime && (
                        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-2)' }}>
                          ⏱️ {t('tasks.planning.planning_time')}: {plan.planningMetadata.planningTime}ms
                        </div>
                      )}
                    </div>
                  </TimelineItem>
                )}
                {plan.steps
                  .sort((a, b) => a.order - b.order)
                  .map((step, index) => (
                    <TimelineItem
                      key={`step-${index}`}
                      color={step.order === 1 ? 'blue' : 'gray'}
                      label={<span style={{ fontSize: 12, fontWeight: 600 }}>Step {step.order}</span>}>
                      <div>
                        <TargetBadge>
                          <span className="index">{step.order}</span>
                          <span>{step.target.name}</span>
                          <Tag style={{ marginLeft: 8 }} color="purple">
                            {step.target.type}
                          </Tag>
                        </TargetBadge>
                        <ReasonText>{step.reason}</ReasonText>
                        {step.estimatedDuration && (
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-2)' }}>
                            ⏱️ {t('tasks.planning.estimated_duration')}: {step.estimatedDuration}s
                          </div>
                        )}
                      </div>
                    </TimelineItem>
                  ))}
              </Timeline>
            </TimelineContainer>
          </Section>
        )}

        {/* Dependencies */}
        {plan.planningMetadata?.dependencies && plan.planningMetadata.dependencies.length > 0 && (
          <Section>
            <SectionTitle>
              {t('tasks.planning.dependencies')} ({plan.planningMetadata.dependencies.length})
            </SectionTitle>
            <div>
              {plan.planningMetadata.dependencies.map((dep, index) => (
                <div
                  key={`dep-${index}`}
                  style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px dashed var(--color-border)' }}>
                  <div style={{ marginBottom: 4 }}>
                    <Tag color="orange">{dep.type}</Tag>
                    <span style={{ fontSize: 13 }}>
                      {dep.from.name} → {dep.to.name}
                    </span>
                  </div>
                  <ReasonText>{dep.reason}</ReasonText>
                </div>
              ))}
            </div>
          </Section>
        )}
      </Container>
    </Modal>
  )
}

export default TaskPlanConfirm
