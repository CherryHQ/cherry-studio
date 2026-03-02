/**
 * Task Detail Panel
 * Compact view showing task info and execution history list
 */

import { loggerService } from '@logger'
import TaskExecutionDetailModal from '@renderer/pages/tasks/components/TaskExecutionDetailModal'
import TaskPlanConfirm from '@renderer/pages/tasks/components/TaskPlanConfirm'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { deleteTask } from '@renderer/store/tasks'
import { abortCompletion } from '@renderer/utils/abortController'
import type { PeriodicTask, TaskExecution, TaskExecutionPlan } from '@types'
import { Button } from 'antd'
import { CheckCircle, ChevronRight, Clock, Edit2, Pause, Play, Square, Trash2, XCircle } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('TaskDetailPanel')

interface TaskDetailPanelProps {
  task: PeriodicTask
  selectedExecution?: TaskExecution
  onExecutionSelect: (execution: TaskExecution) => void
  onClose: () => void
  onEdit: () => void
}

const TaskDetailPanel: FC<TaskDetailPanelProps> = ({ task, selectedExecution, onExecutionSelect, onClose, onEdit }) => {
  const { t, i18n } = useTranslation()
  const dispatch = useAppDispatch()
  const appLanguage = useAppSelector((state) => state.settings.language)

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const executionsPerPage = 10

  // 规划确认相关状态
  const [showPlanConfirm, setShowPlanConfirm] = useState(false)
  const [currentPlan, setCurrentPlan] = useState<TaskExecutionPlan | null>(null)
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)

  // 执行历史状态筛选
  const [executionStatusFilter, setExecutionStatusFilter] = useState<'all' | 'completed' | 'failed' | 'running'>('all')

  // 执行详情弹窗状态
  const [showExecutionDetail, setShowExecutionDetail] = useState(false)

  // 根据状态筛选执行记录
  const filteredExecutions = useMemo(() => {
    if (executionStatusFilter === 'all') {
      return task.executions
    }
    return task.executions.filter((e) => e.status === executionStatusFilter)
  }, [task.executions, executionStatusFilter])

  // 计算总页数
  const totalPages = Math.ceil(filteredExecutions.length / executionsPerPage)

  // 获取当前页的执行记录（倒序，最新的在前）
  const getCurrentPageExecutions = () => {
    const startIndex = (currentPage - 1) * executionsPerPage
    const endIndex = startIndex + executionsPerPage
    return filteredExecutions.slice(startIndex, endIndex)
  }

  // 当任务切换或筛选条件变化时重置页码
  useEffect(() => {
    setCurrentPage(1)
  }, [task.id, executionStatusFilter])

  // 当执行记录数量变化时，确保当前页码有效
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages)
    }
  }, [filteredExecutions.length, totalPages, currentPage])

  /**
   * 生成执行规划
   */
  const generateExecutionPlan = async (): Promise<TaskExecutionPlan | null> => {
    setIsGeneratingPlan(true)
    try {
      logger.info('生成任务执行规划', { taskId: task.id, appLanguage })
      const result = await window.api.task.generatePlan(task.id, i18n.language)

      if (!result.success) {
        throw new Error(result.error || '生成规划失败')
      }

      return result.plan || null
    } catch (error) {
      logger.error('生成规划失败', error as Error)
      window.toast.error(`生成规划失败: ${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      setIsGeneratingPlan(false)
    }
  }

  /**
   * 执行任务
   */
  const executeTask = async (): Promise<TaskExecution | undefined> => {
    setIsExecuting(true)
    try {
      logger.info('执行任务', { taskId: task.id })

      // 添加超时保护
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('任务执行超时（60秒）')), 60000)
      })

      // 调用主进程的执行服务
      const execution = await Promise.race([window.api.task.executeNow(task.id), timeoutPromise])

      logger.info('任务执行完成', { executionId: execution?.id, status: execution?.status })

      // 刷新任务列表以获取最新的执行记录
      await dispatch((await import('@renderer/store/tasksThunk')).loadTasksFromStorage())

      return execution
    } catch (error) {
      logger.error('执行任务失败', error as Error)
      throw error
    } finally {
      setIsExecuting(false)
    }
  }

  /**
   * 处理运行按钮点击
   */
  const handleRun = async () => {
    console.log('[TASKS] TaskDetailPanel handleRun 被调用, taskId:', task.id)
    console.log('[TASKS] 智能规划配置:', task.execution.enableSmartPlanning)
    console.log('[TASKS] 目标数量:', task.targets.length)

    try {
      const enableSmartPlanning = task.execution.enableSmartPlanning ?? true
      const needsPlanning = enableSmartPlanning && task.targets.length > 1

      console.log('[TASKS] 判断条件:', needsPlanning)

      if (needsPlanning) {
        // 步骤1：生成规划
        console.log('[TASKS] 生成执行规划...')
        const plan = await generateExecutionPlan()

        if (!plan) {
          // 规划生成失败，直接执行
          console.log('[TASKS] 规划生成失败，直接执行任务')
          const execution = await executeTask()
          handleExecutionResult(execution)
          return
        }

        // 步骤2：显示规划确认弹窗
        console.log('[TASKS] 显示规划确认弹窗')
        setCurrentPlan(plan)
        setShowPlanConfirm(true)
      } else {
        // 不需要规划，直接执行
        console.log('[TASKS] 直接执行任务（不需要规划）')
        const execution = await executeTask()
        handleExecutionResult(execution)
      }
    } catch (error) {
      console.error('[TASKS] TaskDetailPanel handleRun 出错:', error)
      logger.error('Failed to execute task:', error as Error)
      window.toast.error('任务执行失败')
    }
  }

  /**
   * 处理规划确认
   */
  const handlePlanConfirm = async () => {
    setShowPlanConfirm(false)
    console.log('[TASKS] 用户确认规划，开始执行任务')

    try {
      const execution = await executeTask()
      handleExecutionResult(execution)
    } catch (error) {
      console.error('[TASKS] 执行任务时出错:', error)
      window.toast.error('任务执行失败')
    }
  }

  /**
   * 处理规划取消
   */
  const handlePlanCancel = () => {
    setShowPlanConfirm(false)
    setCurrentPlan(null)
    console.log('[TASKS] 用户取消规划')
    window.toast.info('已取消任务执行')
  }

  /**
   * 处理执行结果
   */
  const handleExecutionResult = (execution?: TaskExecution) => {
    if (!execution) {
      window.toast.info('任务已开始执行')
      return
    }

    if (execution.status === 'completed' && execution.result?.success) {
      window.toast.success('任务执行完成')
    } else if (execution.status === 'failed') {
      window.toast.error(`任务执行失败: ${execution.result?.error}`)
    } else {
      window.toast.info('任务已开始执行')
    }
  }

  const handleDelete = () => {
    window.modal.confirm({
      centered: true,
      content: '确认删除此任务？',
      onOk: () => {
        onClose()
        dispatch(deleteTask(task.id))
      }
    })
  }

  const handleTerminate = async (executionId: string) => {
    window.modal.confirm({
      title: '终止任务',
      content: '确认终止此任务的执行？',
      centered: true,
      onOk: async () => {
        try {
          // Check if the execution is still running
          const execution = task.executions.find((e) => e.id === executionId)

          if (!execution) {
            window.toast.info('任务未找到')
            return
          }

          if (execution.status !== 'running') {
            window.toast.info('任务已完成或已终止')
            return
          }

          // Call abort directly in renderer process
          abortCompletion(executionId)
          logger.info('Task execution terminated', { executionId })

          window.toast.success('任务已终止')

          // Update local state to reflect termination
          onExecutionSelect({
            ...execution,
            status: 'terminated',
            completedAt: new Date().toISOString()
          })
        } catch (error) {
          logger.error('Failed to terminate execution:', error as Error)
          window.toast.error('终止任务失败')
        }
      }
    })
  }

  return (
    <>
      <TaskHeader>
        <TaskInfo>
          <TaskEmoji>{task.emoji || '📝'}</TaskEmoji>
          <TaskName>{task.name}</TaskName>
          <TaskMeta>
            {task.totalRuns} 次执行 · {task.enabled ? '已启用' : '已禁用'}
          </TaskMeta>
        </TaskInfo>
        <HeaderActions>
          {task.schedule.type === 'manual' && (
            <ActionButton type="primary" size="small" onClick={handleRun}>
              <Play size={12} />
              {t('tasks.run')}
            </ActionButton>
          )}
          <ActionButton size="small" onClick={onEdit}>
            <Edit2 size={12} />
            {t('tasks.edit')}
          </ActionButton>
          <ActionButton danger size="small" onClick={handleDelete}>
            <Trash2 size={12} />
            {t('common.delete')}
          </ActionButton>
        </HeaderActions>
      </TaskHeader>

      <TaskSections>
        <TaskSection>
          <SectionTitle>调度配置</SectionTitle>
          <SectionRow>
            <SectionLabel>类型：</SectionLabel>
            <SectionValue>
              {task.schedule.type === 'cron' && 'Cron 表达式'}
              {task.schedule.type === 'interval' && '固定间隔'}
              {task.schedule.type === 'manual' && '手动触发'}
            </SectionValue>
          </SectionRow>
          <SectionRow>
            <SectionLabel>描述：</SectionLabel>
            <SectionValue>{task.schedule.description}</SectionValue>
          </SectionRow>
        </TaskSection>

        <TaskSection>
          <SectionTitle>执行目标</SectionTitle>
          <TargetsList>
            {task.targets.map((target, index) => (
              <TargetItem key={target.id}>
                <TargetIndex>{index + 1}</TargetIndex>
                <TargetInfo>
                  <TargetName>{target.name}</TargetName>
                  <TargetType>
                    {target.type === 'assistant' && '助手'}
                    {target.type === 'agent' && '代理'}
                    {target.type === 'agent_session' && '代理会话'}
                  </TargetType>
                </TargetInfo>
                <TargetId>{target.id.slice(0, 8)}...</TargetId>
              </TargetItem>
            ))}
          </TargetsList>
        </TaskSection>

        <TaskSection>
          <SectionTitle>执行配置</SectionTitle>
          <SectionRow>
            <SectionLabel>消息：</SectionLabel>
            <SectionValueFull>{task.execution.message}</SectionValueFull>
          </SectionRow>
        </TaskSection>

        <TaskSection>
          <SectionTitle>
            执行历史
            {task.executions.length > 0 && <ExecutionCount>（共 {task.executions.length} 条）</ExecutionCount>}
          </SectionTitle>
          <ExecutionStatusFilters>
            <StatusFilterButton
              $active={executionStatusFilter === 'all'}
              onClick={() => setExecutionStatusFilter('all')}>
              全部
            </StatusFilterButton>
            <StatusFilterButton
              $active={executionStatusFilter === 'completed'}
              onClick={() => setExecutionStatusFilter('completed')}>
              <CheckCircle size={12} />
              成功
            </StatusFilterButton>
            <StatusFilterButton
              $active={executionStatusFilter === 'failed'}
              onClick={() => setExecutionStatusFilter('failed')}>
              <XCircle size={12} />
              失败
            </StatusFilterButton>
            <StatusFilterButton
              $active={executionStatusFilter === 'running'}
              onClick={() => setExecutionStatusFilter('running')}>
              <Clock size={12} />
              运行中
            </StatusFilterButton>
          </ExecutionStatusFilters>
          <CompactExecutionList>
            {filteredExecutions.length === 0 ? (
              <ImprovedEmptyState>
                <EmptyStateIconWrapper>
                  {executionStatusFilter === 'all' ? <Clock size={32} /> : null}
                  {executionStatusFilter === 'completed' ? <CheckCircle size={32} /> : null}
                  {executionStatusFilter === 'failed' ? <XCircle size={32} /> : null}
                  {executionStatusFilter === 'running' ? <Clock size={32} /> : null}
                </EmptyStateIconWrapper>
                <EmptyStateText>
                  {executionStatusFilter === 'all' && '暂无执行记录'}
                  {executionStatusFilter === 'completed' && '暂无成功的执行记录'}
                  {executionStatusFilter === 'failed' && '暂无失败的执行记录'}
                  {executionStatusFilter === 'running' && '暂无运行中的任务'}
                </EmptyStateText>
                {task.schedule.type === 'manual' && executionStatusFilter === 'all' && (
                  <EmptyStateHint>点击上方"立即执行"按钮开始执行任务</EmptyStateHint>
                )}
              </ImprovedEmptyState>
            ) : (
              <>
                {getCurrentPageExecutions().map((execution) => (
                  <CompactExecutionItem
                    key={execution.id}
                    $selected={selectedExecution?.id === execution.id}
                    onClick={() => {
                      onExecutionSelect(execution)
                      setShowExecutionDetail(true)
                    }}>
                    <ExecutionMain>
                      <ExecutionTime>
                        {new Date(execution.startedAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </ExecutionTime>
                      <ExecutionStatus status={execution.status}>
                        {execution.status === 'completed' && <CheckCircle size={11} />}
                        {execution.status === 'failed' && <XCircle size={11} />}
                        {execution.status === 'running' && <Clock size={11} />}
                        {execution.status === 'paused' && <Pause size={11} />}
                        {execution.status === 'completed' && '成功'}
                        {execution.status === 'failed' && '失败'}
                        {execution.status === 'running' && '运行中'}
                        {execution.status === 'paused' && '暂停'}
                      </ExecutionStatus>
                    </ExecutionMain>
                    <ExecutionMeta>
                      {execution.completedAt ? (
                        <ExecutionDuration>
                          {Math.round(
                            (new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000
                          )}
                          s
                        </ExecutionDuration>
                      ) : (
                        <ExecutionDuration>-</ExecutionDuration>
                      )}
                      {execution.status === 'running' && (
                        <TerminateButtonSmall
                          onClick={(e) => {
                            e.stopPropagation()
                            handleTerminate(execution.id)
                          }}>
                          <Square size={10} />
                          终止
                        </TerminateButtonSmall>
                      )}
                    </ExecutionMeta>
                    <ExpandIcon>
                      <ChevronRight size={14} />
                    </ExpandIcon>
                  </CompactExecutionItem>
                ))}

                {/* 分页控件 */}
                {totalPages > 1 && (
                  <PaginationControls>
                    <PaginationButton
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}>
                      上一页
                    </PaginationButton>
                    <PaginationInfo>
                      第 {currentPage} / {totalPages} 页
                    </PaginationInfo>
                    <PaginationButton
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}>
                      下一页
                    </PaginationButton>
                  </PaginationControls>
                )}
              </>
            )}
          </CompactExecutionList>
        </TaskSection>
      </TaskSections>

      {/* 规划确认弹窗 */}
      <TaskPlanConfirm
        open={showPlanConfirm}
        plan={currentPlan}
        taskName={task.name}
        onConfirm={handlePlanConfirm}
        onCancel={handlePlanCancel}
        loading={isGeneratingPlan || isExecuting}
      />

      {/* Execution Detail Modal */}
      <TaskExecutionDetailModal
        execution={selectedExecution ?? null}
        open={showExecutionDetail}
        onClose={() => setShowExecutionDetail(false)}
      />
    </>
  )
}

const TaskHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 12px;
  border-bottom: 0.5px solid var(--color-border);
  margin-bottom: 12px;
`

const TaskInfo = styled.div`
  flex: 1;
  min-width: 0;
`

const TaskEmoji = styled.span`
  font-size: 18px;
  line-height: 1;
`

const TaskName = styled.div`
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text-1);
  margin: 4px 0;
`

const TaskMeta = styled.div`
  font-size: 11px;
  color: var(--color-text-2);
`

const HeaderActions = styled.div`
  display: flex;
  gap: 6px;
`

const ActionButton = styled(Button)`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 4px 10px;
  height: auto;
`

const TaskSections = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const TaskSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-2);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const SectionRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
`

const SectionLabel = styled.span`
  color: var(--color-text-2);
  min-width: 60px;
  flex-shrink: 0;
`

const SectionValue = styled.span`
  color: var(--color-text-1);
  flex: 1;
  word-break: break-word;
`

const SectionValueFull = styled.div`
  color: var(--color-text-1);
  background: var(--color-background-soft);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
`

const TargetsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const TargetItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--color-background-soft);
  border-radius: 6px;
  font-size: 12px;
`

const TargetIndex = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: var(--color-primary);
  color: white;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
`

const TargetInfo = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const TargetName = styled.span`
  font-size: 12px;
  color: var(--color-text-1);
  font-weight: 500;
`

const TargetType = styled.span`
  font-size: 11px;
  color: var(--color-text-2);
  padding: 2px 6px;
  background: var(--color-background);
  border-radius: 3px;
  flex-shrink: 0;
`

const TargetId = styled.code`
  font-size: 10px;
  color: var(--color-text-3);
  font-family: monospace;
  flex-shrink: 0;
`

const CompactExecutionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const ExecutionStatusFilters = styled.div`
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
`

const StatusFilterButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  height: 28px;
  font-size: 11px;
  color: ${(props) => (props.$active ? 'var(--color-text)' : 'var(--color-text-secondary)')};
  font-weight: ${(props) => (props.$active ? '600' : '400')};
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;

  &:hover {
    color: var(--color-text);
  }

  &:active {
    transform: scale(0.98);
  }

  &::after {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: ${(props) => (props.$active ? '20px' : '0')};
    height: 2px;
    background: var(--color-primary);
    border-radius: 1px;
    transition: all 0.2s ease;
  }

  &:hover::after {
    width: ${(props) => (props.$active ? '20px' : '12px')};
    background: ${(props) => (props.$active ? 'var(--color-primary)' : 'var(--color-primary-soft)')};
  }
`

const CompactExecutionItem = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: ${(props) => (props.$selected ? 'var(--color-primary-bg)' : 'transparent')};
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--color-hover-background);
  }
`

const ExecutionMain = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const ExecutionTime = styled.span`
  font-size: 12px;
  color: var(--color-text-1);
  flex-shrink: 0;
`

const ExecutionCount = styled.span`
  font-size: 11px;
  color: var(--color-text-2);
  font-weight: 400;
  margin-left: 4px;
`

const PaginationControls = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px;
  margin-top: 8px;
  border-top: 0.5px solid var(--color-border);
`

const PaginationButton = styled.button<{ disabled?: boolean }>`
  padding: 4px 12px;
  font-size: 11px;
  color: ${(props) => (props.disabled ? 'var(--color-text-3)' : 'var(--color-text-1)')};
  background: transparent;
  border: 0.5px solid var(--color-border);
  border-radius: 4px;
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: var(--color-hover-background);
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
`

const PaginationInfo = styled.span`
  font-size: 11px;
  color: var(--color-text-2);
`

const ExecutionStatus = styled.span<{ status: string }>`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  flex-shrink: 0;

  &[status="completed"] {
    background: var(--color-success-bg);
    color: var(--color-success);
  }

  &[status="failed"] {
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  &[status="running"] {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }

  &[status="paused"] {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }
`

const ExecutionMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const ExecutionDuration = styled.span`
  font-size: 11px;
  color: var(--color-text-2);
`

const TerminateButtonSmall = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  font-size: 10px;
  color: var(--color-error);
  background: var(--color-error-bg);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--color-error);
    color: white;
  }
`

const ExpandIcon = styled.div`
  color: var(--color-text-3);
  flex-shrink: 0;
  display: flex;

  ${CompactExecutionItem}:hover & {
    color: var(--color-text-1);
  }
`

const ImprovedEmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
`

const EmptyStateIconWrapper = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-background-soft);
  color: var(--color-text-2);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
`

const EmptyStateText = styled.div`
  font-size: 13px;
  color: var(--color-text-2);
  margin-bottom: 4px;
`

const EmptyStateHint = styled.div`
  font-size: 11px;
  color: var(--color-text-3);
`

export default TaskDetailPanel
