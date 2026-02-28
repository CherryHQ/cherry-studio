/**
 * Task Card Component
 * Displays a periodic task in a card format
 */

import type { PeriodicTask, TaskListItem } from '@types'
import { CheckCircle, Clock, Pause, XCircle } from 'lucide-react'
import type { FC } from 'react'
import styled from 'styled-components'

interface TaskCardProps {
  task: PeriodicTask
  listItem: TaskListItem
  onClick: (taskId: string) => void
}

const TaskCard: FC<TaskCardProps> = ({ task, onClick }) => {
  const getStatusIcon = () => {
    const lastExecution = task.executions[0]
    if (!lastExecution) {
      return <Clock size={16} />
    }
    switch (lastExecution.status) {
      case 'completed':
        return <CheckCircle size={16} style={{ color: 'var(--color-success)' }} />
      case 'failed':
        return <XCircle size={16} style={{ color: 'var(--color-error)' }} />
      case 'running':
        return <Clock size={16} style={{ color: 'var(--color-primary)' }} />
      case 'paused':
        return <Pause size={16} style={{ color: 'var(--color-warning)' }} />
      default:
        return <Clock size={16} />
    }
  }

  return (
    <Card onClick={() => onClick(task.id)} $enabled={task.enabled}>
      <CardHeader>
        <Emoji>{task.emoji || '📝'}</Emoji>
        <StatusBadge $enabled={task.enabled}>{task.enabled ? '启用' : '禁用'}</StatusBadge>
      </CardHeader>
      <TaskName>{task.name}</TaskName>
      <TaskInfo>
        <ScheduleInfo>{task.schedule.description}</ScheduleInfo>
      </TaskInfo>
      <TaskFooter>
        <RunsInfo>
          {getStatusIcon()}
          <RunsText>{task.totalRuns} 次执行</RunsText>
        </RunsInfo>
        <TargetCount>{task.targets.length} 个目标</TargetCount>
      </TaskFooter>
    </Card>
  )
}

const Card = styled.div<{ $enabled: boolean }>`
  display: flex;
  flex-direction: column;
  width: 115px;
  height: 85px;
  padding: 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--color-background);
  border: 2px solid transparent;
  opacity: ${(props) => (props.$enabled ? 1 : 0.6)};

  &:hover {
    border-color: var(--color-primary);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
`

const CardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 4px;
`

const Emoji = styled.div`
  font-size: 20px;
  line-height: 1;
`

const StatusBadge = styled.span<{ $enabled: boolean }>`
  font-size: 9px;
  padding: 2px 4px;
  border-radius: 4px;
  background: ${(props) => (props.$enabled ? 'var(--color-success-bg)' : 'var(--color-text-3)')};
  color: ${(props) => (props.$enabled ? 'var(--color-success)' : 'var(--color-text-2)')};
  font-weight: 500;
`

const TaskName = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
`

const TaskInfo = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
`

const ScheduleInfo = styled.div`
  font-size: 10px;
  color: var(--color-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TaskFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
`

const RunsInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const RunsText = styled.span`
  font-size: 9px;
  color: var(--color-text-2);
`

const TargetCount = styled.span`
  font-size: 9px;
  color: var(--color-primary);
  background: var(--color-primary-bg);
  padding: 2px 6px;
  border-radius: 4px;
`

export default TaskCard
