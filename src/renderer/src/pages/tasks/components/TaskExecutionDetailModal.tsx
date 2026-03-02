/**
 * Task Execution Detail Modal
 * Displays detailed information about a task execution including plan analysis
 */

import TaskPlanAnalysis from '@renderer/pages/tasks/components/TaskPlanAnalysis'
import TaskPlanFlowDiagram from '@renderer/pages/tasks/components/TaskPlanFlowDiagram'
import type { TaskExecution } from '@types'
import { Alert, Modal, Tabs, Tag } from 'antd'
import { CheckCircle, Clock, Square, XCircle } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface TaskExecutionDetailModalProps {
  execution: TaskExecution | null
  open: boolean
  onClose: () => void
}

const TaskExecutionDetailModal: FC<TaskExecutionDetailModalProps> = ({ execution, open, onClose }) => {
  const { t } = useTranslation()

  if (!execution) return null

  const hasPlan = !!execution.plan
  const hasAnalysis = !!execution.planAnalysis
  const hasOutput = !!execution.result?.output

  const items = [
    {
      key: 'details',
      label: t('tasks.execution_details', { defaultValue: '执行详情' }),
      children: (
        <div style={{ padding: '16px' }}>
          <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {execution.status === 'completed' && <CheckCircle size={16} style={{ color: 'var(--color-success)' }} />}
            {execution.status === 'failed' && <XCircle size={16} style={{ color: 'var(--color-error)' }} />}
            {execution.status === 'running' && <Clock size={16} style={{ color: 'var(--color-primary)' }} />}
            {execution.status === 'terminated' && <Square size={16} style={{ color: 'var(--color-warning)' }} />}
            <strong style={{ fontSize: 14 }}>
              {execution.status === 'completed' && '执行成功'}
              {execution.status === 'failed' && '执行失败'}
              {execution.status === 'running' && '正在运行'}
              {execution.status === 'terminated' && '已终止'}
            </strong>
            <Tag
              color={
                execution.status === 'completed' ? 'success' : execution.status === 'failed' ? 'error' : 'default'
              }>
              {execution.status}
            </Tag>
          </div>
          <div style={{ marginBottom: '12px', fontSize: 13, color: 'var(--color-text-2)' }}>
            <span style={{ display: 'inline-block', minWidth: '80px' }}>开始时间：</span>
            <span style={{ color: 'var(--color-text-1)' }}>
              {new Date(execution.startedAt).toLocaleString('zh-CN')}
            </span>
          </div>
          {execution.completedAt && (
            <div style={{ marginBottom: '12px', fontSize: 13, color: 'var(--color-text-2)' }}>
              <span style={{ display: 'inline-block', minWidth: '80px' }}>完成时间：</span>
              <span style={{ color: 'var(--color-text-1)' }}>
                {new Date(execution.completedAt).toLocaleString('zh-CN')}
              </span>
            </div>
          )}
          {execution.result?.duration && (
            <div style={{ marginBottom: '12px', fontSize: 13, color: 'var(--color-text-2)' }}>
              <span style={{ display: 'inline-block', minWidth: '80px' }}>执行时长：</span>
              <span style={{ color: 'var(--color-text-1)', fontWeight: 500 }}>
                {(execution.result.duration / 1000).toFixed(2)}s
              </span>
            </div>
          )}
          {execution.result?.error && (
            <Alert
              message="执行错误"
              description={execution.result.error}
              type="error"
              showIcon
              style={{ marginTop: '12px' }}
            />
          )}
        </div>
      )
    },
    {
      key: 'output',
      label: t('tasks.execution_output', { defaultValue: '执行输出' }),
      children: hasOutput ? (
        <div style={{ padding: '16px', whiteSpace: 'pre-wrap', maxHeight: '400px', overflowY: 'auto' }}>
          {execution.result?.output}
        </div>
      ) : (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-2)' }}>暂无输出</div>
      )
    }
  ]

  if (hasPlan) {
    items.push({
      key: 'plan',
      label: t('tasks.execution_plan', { defaultValue: '执行计划' }),
      children: (
        <div style={{ padding: '16px' }}>
          <TaskPlanFlowDiagram plan={execution.plan!} />
        </div>
      )
    })
  }

  if (hasAnalysis) {
    items.push({
      key: 'analysis',
      label: t('tasks.analysis.title', { defaultValue: '执行分析' }),
      children: (
        <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
          <TaskPlanAnalysis analysis={execution.planAnalysis!} />
        </div>
      )
    })
  }

  return (
    <Modal
      open={open}
      title={t('tasks.execution_detail_title', { defaultValue: '执行详情' })}
      onCancel={onClose}
      footer={null}
      width={900}
      style={{ top: 20 }}
      destroyOnHidden
      keyboard
      centered>
      <Tabs defaultActiveKey="details" items={items} />
    </Modal>
  )
}

export default TaskExecutionDetailModal
