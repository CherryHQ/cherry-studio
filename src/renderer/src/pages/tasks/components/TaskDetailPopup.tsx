/**
 * Task Detail Popup
 * Shows detailed information about a task and its execution history
 */

import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addExecution, deleteTask, getTaskById } from '@renderer/store/tasks'
import { Button, Modal } from 'antd'
import { CheckCircle, Clock, Edit2, Pause, Play, Trash2, XCircle } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface TaskDetailPopupProps {
  open: boolean
  taskId: string
  onClose: () => void
  onEdit: () => void
  onRun?: (taskId: string) => void
}

const TaskDetailPopup: FC<TaskDetailPopupProps> = ({ open, taskId, onClose, onEdit, onRun }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const task = useAppSelector((state) => getTaskById(state)(taskId))

  if (!task) {
    return null
  }

  const handleRun = () => {
    // Create a new execution record
    const execution = {
      id: `exec-${Date.now()}`,
      taskId,
      status: 'running' as const,
      startedAt: new Date().toISOString()
    }
    dispatch(addExecution({ taskId, execution }))
    onRun?.(taskId)
  }

  const isManualTask = task.schedule.type === 'manual'
  const isRunning = task.executions[0]?.status === 'running'

  const handleDelete = () => {
    window.modal.confirm({
      centered: true,
      content: '确认删除此任务？',
      onOk: () => {
        dispatch(deleteTask(taskId))
        onClose()
      }
    })
  }

  return (
    <Modal
      title={
        <Title>
          <Emoji>{task.emoji || '📝'}</Emoji>
          {task.name}
        </Title>
      }
      open={open}
      onCancel={onClose}
      width={700}
      footer={
        <Footer>
          {isManualTask && onRun && (
            <Button onClick={handleRun} disabled={isRunning} icon={<Play size={14} />}>
              {isRunning ? t('tasks.status.running') : t('tasks.run')}
            </Button>
          )}
          <Button onClick={onEdit} icon={<Edit2 size={14} />}>
            {t('tasks.edit')}
          </Button>
          <Button danger onClick={handleDelete} icon={<Trash2 size={14} />}>
            {t('common.delete')}
          </Button>
        </Footer>
      }>
      <Content>
        <Section>
          <SectionTitle>{t('tasks.executionConfig.message')}</SectionTitle>
          <InfoRow>
            <InfoLabel>描述：</InfoLabel>
            <InfoValue>{task.description || '无描述'}</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>状态：</InfoLabel>
            <StatusBadge $enabled={task.enabled}>{task.enabled ? '已启用' : '已禁用'}</StatusBadge>
          </InfoRow>
          <InfoRow>
            <InfoLabel>执行次数：</InfoLabel>
            <InfoValue>{task.totalRuns} 次</InfoValue>
          </InfoRow>
        </Section>

        <Section>
          <SectionTitle>调度配置</SectionTitle>
          <InfoRow>
            <InfoLabel>类型：</InfoLabel>
            <InfoValue>
              {task.schedule.type === 'cron' && 'Cron 表达式'}
              {task.schedule.type === 'interval' && '固定间隔'}
              {task.schedule.type === 'manual' && '手动触发'}
            </InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>描述：</InfoLabel>
            <InfoValue>{task.schedule.description}</InfoValue>
          </InfoRow>
          {task.schedule.cronExpression && (
            <InfoRow>
              <InfoLabel>Cron 表达式：</InfoLabel>
              <CodeValue>{task.schedule.cronExpression}</CodeValue>
            </InfoRow>
          )}
        </Section>

        <Section>
          <SectionTitle>执行目标</SectionTitle>
          <TargetList>
            {task.targets.map((target, index) => (
              <TargetItem key={index}>
                <TargetType>{target.type === 'agent' ? '智能体' : '助手'}</TargetType>
                <TargetName>{target.name}</TargetName>
              </TargetItem>
            ))}
          </TargetList>
        </Section>

        <Section>
          <SectionTitle>执行配置</SectionTitle>
          <InfoRow>
            <InfoLabel>消息：</InfoLabel>
            <MessageValue>{task.execution.message}</MessageValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>继续对话：</InfoLabel>
            <InfoValue>{task.execution.continueConversation ? '是' : '否'}</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>超时时间：</InfoLabel>
            <InfoValue>{task.execution.maxExecutionTime || 300} 秒</InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>完成通知：</InfoLabel>
            <InfoValue>{task.execution.notifyOnComplete ? '启用' : '禁用'}</InfoValue>
          </InfoRow>
        </Section>

        <Section>
          <SectionTitle>执行历史</SectionTitle>
          <ExecutionHistory>
            {task.executions.length === 0 ? (
              <EmptyState>暂无执行记录</EmptyState>
            ) : (
              task.executions.map((execution) => (
                <ExecutionItem key={execution.id}>
                  <ExecutionHeader>
                    <ExecutionIcon status={execution.status}>
                      {execution.status === 'completed' && <CheckCircle size={16} />}
                      {execution.status === 'failed' && <XCircle size={16} />}
                      {execution.status === 'running' && <Clock size={16} />}
                      {execution.status === 'paused' && <Pause size={16} />}
                    </ExecutionIcon>
                    <ExecutionInfo>
                      <ExecutionTime>{new Date(execution.startedAt).toLocaleString('zh-CN')}</ExecutionTime>
                      {execution.completedAt && (
                        <ExecutionDuration>
                          (
                          {Math.round(
                            (new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000
                          )}
                          s)
                        </ExecutionDuration>
                      )}
                    </ExecutionInfo>
                  </ExecutionHeader>
                  {execution.result && (
                    <ExecutionResult>
                      {execution.result.success ? <SuccessText>成功</SuccessText> : <ErrorText>失败</ErrorText>}
                      {execution.result.output && <OutputText>{execution.result.output}</OutputText>}
                      {execution.result.error && <ErrorText>{execution.result.error}</ErrorText>}
                    </ExecutionResult>
                  )}
                  {execution.status === 'running' && <RunningStatus>执行中...</RunningStatus>}
                </ExecutionItem>
              ))
            )}
          </ExecutionHistory>
        </Section>
      </Content>
    </Modal>
  )
}

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 500;
`

const Emoji = styled.span`
  font-size: 20px;
`

const Content = styled.div`
  max-height: 60vh;
  overflow-y: auto;
`

const Section = styled.div`
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
`

const SectionTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
  margin-bottom: 12px;
`

const InfoRow = styled.div`
  display: flex;
  align-items: flex-start;
  margin-bottom: 8px;
  font-size: 13px;
`

const InfoLabel = styled.div`
  color: var(--color-text-2);
  min-width: 100px;
`

const InfoValue = styled.div`
  color: var(--color-text-1);
  flex: 1;
`

const CodeValue = styled.code`
  padding: 2px 6px;
  background: var(--color-background);
  border-radius: 4px;
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 12px;
`

const StatusBadge = styled.span<{ $enabled: boolean }>`
  padding: 2px 8px;
  border-radius: 4px;
  background: ${(props) => (props.$enabled ? 'var(--color-success-bg)' : 'var(--color-text-3)')};
  color: ${(props) => (props.$enabled ? 'var(--color-success)' : 'var(--color-text-2)')};
  font-size: 12px;
`

const TargetList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const TargetItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-background);
  border-radius: 8px;
`

const TargetType = styled.span`
  font-size: 11px;
  padding: 2px 6px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
  border-radius: 4px;
`

const TargetName = styled.span`
  font-size: 13px;
  color: var(--color-text-1);
`

const MessageValue = styled.div`
  color: var(--color-text-1);
  background: var(--color-background);
  padding: 8px 12px;
  border-radius: 8px;
  white-space: pre-wrap;
`

const ExecutionHistory = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const EmptyState = styled.div`
  text-align: center;
  padding: 20px;
  color: var(--color-text-2);
  font-size: 13px;
`

const ExecutionItem = styled.div`
  padding: 12px;
  background: var(--color-background);
  border-radius: 8px;
`

const ExecutionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
`

const ExecutionIcon = styled.div<{ status: string }>`
  display: flex;
  align-items: center;

  &[status="completed"] {
    color: var(--color-success);
  }

  &[status="failed"] {
    color: var(--color-error);
  }

  &[status="running"] {
    color: var(--color-primary);
  }

  &[status="paused"] {
    color: var(--color-warning);
  }
`

const ExecutionInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
`

const ExecutionTime = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
`

const ExecutionDuration = styled.span`
  font-size: 11px;
  color: var(--color-text-3);
`

const ExecutionResult = styled.div`
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
`

const SuccessText = styled.div`
  font-size: 12px;
  color: var(--color-success);
  margin-bottom: 4px;
`

const ErrorText = styled.div`
  font-size: 12px;
  color: var(--color-error);
  margin-bottom: 4px;
`

const OutputText = styled.pre`
  font-size: 12px;
  color: var(--color-text-1);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 0;
`

const RunningStatus = styled.div`
  font-size: 12px;
  color: var(--color-primary);
`

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
`

export default TaskDetailPopup
